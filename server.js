const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');
const db = require('./database');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const adminIds = ['894038665116909659'];  
const logChannelId = '1250138931387830343';  
const userCooldowns = new Map();

const express = require('express');
const app = express();
const PORT = 3000;

app.get('/verify', (req, res) => {
    const { key, discord_id, hwid } = req.query;

    if (!key || !discord_id || !hwid) {
        return res.json({ status: false, msg: 'Thiếu tham số' });
    }

    db.get('SELECT * FROM keys WHERE key = ? AND discord_id = ?', [key, discord_id], (err, row) => {
        if (err) {
            return res.json({ status: false, msg: 'Đã xảy ra lỗi.' });
        }
        if (!row) {
            return res.json({ status: false, msg: 'Key hoặc Discord ID không đúng.' });
        }
        if (row.banned) { 
            return res.json({ status: false, msg: 'User in blacklist' }); 
        }
        if (!row.hwid) {
            db.run('UPDATE keys SET hwid = ? WHERE key = ?', [hwid, key], function(err) {
                if (err) {
                    return res.json({ status: false, msg: 'Đã xảy ra lỗi khi cập nhật HWID.' });
                }
                return res.json({ status: true, username: discord_id });
            });
        } else if (row.hwid === hwid) {
            return res.json({ status: true, username: discord_id });
        } else {
            return res.json({ status: false, msg: 'Khác HWID' });
        }
    });
});

app.listen(PORT, () => {
    console.log(`API server is running on http://localhost:${PORT}`);
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);

    const statuses = [
        '/redeem to redeem',
        '/script to get script',
        '/reset hwid to reset hwid'
    ];
    let index = 0;

    setInterval(() => {
        client.user.setActivity(statuses[index], { type: ActivityType.Playing });
        index = (index + 1) % statuses.length;
    }, 3000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, user, options } = interaction;

    // Check for cooldown (skip for admins)
    if (!adminIds.includes(user.id)) {
        if (userCooldowns.has(user.id)) {
            const expirationTime = userCooldowns.get(user.id) + 5000;
            if (Date.now() < expirationTime) {
                const timeLeft = (expirationTime - Date.now()) / 1000;
                return interaction.reply({ content: `Please wait ${timeLeft.toFixed(1)} seconds before using another command.`, ephemeral: true });
            }
        }
        userCooldowns.set(user.id, Date.now());
    }

    const logChannel = await client.channels.fetch(logChannelId);
    
    const logInteraction = (message) => {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('Log Interaction')
            .setDescription(message)
            .setTimestamp();
        logChannel.send({ embeds: [embed] });
    };

    if (commandName === 'createkey' && adminIds.includes(user.id)) {
        const quantity = options.getInteger('quantity') || 1;
        const keys = [];

        for (let i = 0; i < quantity; i++) {
            const key = generateKey();
            keys.push(key);
            db.run('INSERT INTO keys (key) VALUES (?)', [key], function(err) {
                if (err) {
                    return interaction.reply({ content: 'An error occurred while creating the key.', ephemeral: true });
                }
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('New Keys Created')
            .setDescription(`Key list:\n${keys.map(k => `\`${k}\``).join('\n')}`)
            .setTimestamp();
        interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (commandName === 'redeem') {
        const key = options.getString('key');
        db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
            if (err) {
                return interaction.reply({ content: 'An error occurred.', ephemeral: true });
            }
            if (row) {
                if (row.discord_id) {
                    interaction.reply({ content: 'This key has already been redeemed.', ephemeral: true });
                    logInteraction(`User ${user.tag} attempted to redeem key ${key} but it was already redeemed.`);
                    return;
                }

                // Kiểm tra nếu người dùng bị ban
                db.get('SELECT banned FROM keys WHERE discord_id = ?', [user.id], (err, userRow) => {
                    if (err) {
                        return interaction.reply({ content: 'An error occurred.', ephemeral: true });
                    }

                    if (userRow && userRow.banned) {
                        // Nếu bị ban, unban người dùng
                        db.run('UPDATE keys SET banned = 0 WHERE discord_id = ?', [user.id], function(err) {
                            if (err) {
                                interaction.reply({ content: 'An error occurred while unbanning.', ephemeral: true });
                                logInteraction(`Error unbanning user ${user.tag}: ${err.message}`);
                                return;
                            }
                        });
                    }

                    // Tiến hành đổi key
                    db.run('UPDATE keys SET discord_id = ? WHERE key = ?', [user.id, key], function(err) {
                        if (err) {
                            interaction.reply({ content: 'An error occurred while redeeming the key.', ephemeral: true });
                            logInteraction(`Error redeeming key ${key} for user ${user.tag}: ${err.message}`);
                            return;
                        }
                        const embed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle('Redeem Successful')
                            .setDescription('Your key has been successfully redeemed!')
                            .setTimestamp();
                        interaction.reply({ embeds: [embed], ephemeral: true });
                        logInteraction(`User ${user.tag} successfully redeemed key ${key}.`);
                    });
                });

            } else {
                interaction.reply({ content: 'Invalid key.', ephemeral: true });
                logInteraction(`User ${user.tag} attempted to redeem invalid key ${key}.`);
            }
        });
    } else if (commandName === 'resethwid') {
        db.get('SELECT * FROM keys WHERE discord_id = ?', [user.id], (err, row) => {
            if (err) {
                return interaction.reply({ content: 'An error occurred.', ephemeral: true });
            }
    
            if (!row) {
                return interaction.reply({ content: 'You have not redeemed a key, so you cannot reset HWID.', ephemeral: true });
            }
    
            const now = new Date();
            db.get('SELECT last_reset FROM users WHERE discord_id = ?', [user.id], (err, userRow) => {
                if (err) {
                    return interaction.reply({ content: 'An error occurred.', ephemeral: true });
                }
    
                if (userRow && userRow.last_reset) {
                    const lastReset = new Date(userRow.last_reset);
                    const diffTime = now - lastReset;
                    if (diffTime < 86400000 && !adminIds.includes(user.id)) {
                        const remainingTime = 86400000 - diffTime;
                        const diffHours = Math.floor(remainingTime / (1000 * 60 * 60));
                        const diffMinutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
                        const diffSeconds = Math.floor((remainingTime % (1000 * 60)) / 1000);
    
                        return interaction.reply({ content: `You have already reset HWID. Please try again in ${diffHours} hours ${diffMinutes} minutes ${diffSeconds} seconds.`, ephemeral: true });
                    }
                }
    
                db.run('UPDATE keys SET hwid = NULL WHERE discord_id = ?', [user.id], function(err) {
                    if (err) {
                        return interaction.reply({ content: 'An error occurred while resetting HWID.', ephemeral: true });
                    }
                    db.run('INSERT OR REPLACE INTO users (discord_id, last_reset) VALUES (?, ?)', [user.id, now.toISOString()], function(err) {
                        if (err) {
                            return interaction.reply({ content: 'An error occurred while updating the reset.', ephemeral: true });
                        }
                        const embed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle('HWID Reset Successful')
                            .setDescription('Your HWID has been successfully reset!')
                            .setTimestamp();
                        interaction.reply({ embeds: [embed], ephemeral: true });
                    });
                });
            });
        });
    } else if (commandName === 'script') {
        db.get('SELECT hwid FROM keys WHERE discord_id = ?', [user.id], (err, row) => {
            if (err) {
                interaction.reply({ content: 'An error occurred.', ephemeral: true });
                logInteraction(`Error fetching HWID for user ${user.tag}: ${err.message}`);
                return;
            }
            if (row) {
                // Embed 1: Lời cảm ơn
                const embed1 = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('Thank you from NHN')
                    .setDescription('Thank you for using our service! Below is your script.')
                    .setTimestamp();

                // Embed 2: Script
                const embed2 = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('Your Script')
                    .setDescription(`\`\`\`lua\nlocal key = "${row.hwid ? row.hwid : 'Your_Hwid'}"\n-- Your script code here\n\`\`\``)
                    .setTimestamp();

                interaction.reply({ embeds: [embed1, embed2], ephemeral: true });
                logInteraction(`User ${user.tag} fetched their script.`);
            } else {
                interaction.reply({ content: 'You have not redeemed a key.', ephemeral: true });
                logInteraction(`User ${user.tag} attempted to fetch script but has not redeemed a key.`);
            }
        });
    } else if (commandName === 'check') {
        db.get('SELECT hwid, banned FROM keys WHERE discord_id = ?', [user.id], (err, row) => {
            if (err) {
                interaction.reply({ content: 'An error occurred.', ephemeral: true });
                logInteraction(`Error checking HWID for user ${user.tag}: ${err.message}`);
                return;
            }
            if (row) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('HWID Status')
                    .setDescription(row.hwid ? `Your current HWID: \`${row.hwid}\`` : 'You have not set an HWID yet.')
                    .addFields(
                        { name: 'Ban Status', value: row.banned ? 'Banned' : 'Not Banned' }
                    )
                    .setTimestamp();
                interaction.reply({ embeds: [embed], ephemeral: true });
                logInteraction(`User ${user.tag} checked their HWID.`);
            } else {
                interaction.reply({ content: 'You have not redeemed a key.', ephemeral: true });
                logInteraction(`User ${user.tag} attempted to check HWID but has not redeemed a key.`);
            }
        });
    } else if (commandName === 'adminkeyinfo' && adminIds.includes(user.id)) {
        const key = options.getString('key');
        db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
            if (err) {
                return interaction.reply({ content: 'An error occurred.', ephemeral: true });
            }
            if (row) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('Key Information')
                    .addFields(
                        { name: 'Key', value: row.key, inline: true },
                        { name: 'Discord ID', value: row.discord_id || 'Not Redeemed', inline: true },
                        { name: 'HWID', value: row.hwid || 'None', inline: true },
                        { name: 'Ban Status', value: row.banned ? 'Banned' : 'Not Banned', inline: true }
                    )
                    .setTimestamp();
                interaction.reply({ embeds: [embed], ephemeral: true });
            } else {
                interaction.reply({ content: 'Invalid key.', ephemeral: true });
            }
        });
    } else if (commandName === 'adminuserinfo' && adminIds.includes(user.id)) {
        const discordId = options.getString('discord_id');
        db.get('SELECT * FROM keys WHERE discord_id = ?', [discordId], (err, row) => {
            if (err) {
                return interaction.reply({ content: 'An error occurred.', ephemeral: true });
            }
            if (row) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('User Information')
                    .addFields(
                        { name: 'Key', value: row.key, inline: true },
                        { name: 'Discord ID', value: row.discord_id, inline: true },
                        { name: 'HWID', value: row.hwid || 'None', inline: true },
                        { name: 'Ban Status', value: row.banned ? 'Banned' : 'Not Banned', inline: true }
                    )
                    .setTimestamp();
                interaction.reply({ embeds: [embed], ephemeral: true });
            } else {
                interaction.reply({ content: 'User not found or no key redeemed.', ephemeral: true });
            }
        });
    } else if (commandName === 'adminresethwid' && adminIds.includes(user.id)) {
        const discordId = options.getString('discord_id');
        db.get('SELECT * FROM keys WHERE discord_id = ?', [discordId], (err, row) => {
            if (err) {
                return interaction.reply({ content: 'An error occurred.', ephemeral: true });
            }
            if (row) {
                db.run('UPDATE keys SET hwid = NULL WHERE discord_id = ?', [discordId], function(err) {
                    if (err) {
                        return interaction.reply({ content: 'An error occurred while resetting HWID.', ephemeral: true });
                    }
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('HWID Reset Successful')
                        .setDescription(`HWID for user \`${discordId}\` has been successfully reset!`)
                        .setTimestamp();
                    interaction.reply({ embeds: [embed], ephemeral: true });
                });
            } else {
                interaction.reply({ content: 'User not found or no key redeemed.', ephemeral: true });
            }
        });
    } else if (commandName === 'adminbankey' && adminIds.includes(user.id)) {
        const key = options.getString('key');
        db.run('UPDATE keys SET banned = 1 WHERE key = ?', [key], function(err) {
            if (err) {
                return interaction.reply({ content: 'An error occurred while banning the key.', ephemeral: true });
            }
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Key Banned')
                .setDescription(`The key \`${key}\` has been banned.`)
                .setTimestamp();
            interaction.reply({ embeds: [embed], ephemeral: true });
        });
    } else if (commandName === 'adminunbankey' && adminIds.includes(user.id)) {
        const key = options.getString('key');
        db.run('UPDATE keys SET banned = 0 WHERE key = ?', [key], function(err) {
            if (err) {
                return interaction.reply({ content: 'An error occurred while unbanning the key.', ephemeral: true });
            }
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('Key Unbanned')
                .setDescription(`The key \`${key}\` has been unbanned.`)
                .setTimestamp();
            interaction.reply({ embeds: [embed], ephemeral: true });
        });
    }
});

const generateKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = 'NHN-';
    for (let i = 0; i < 12; i++) {
        if (i > 0 && i % 4 === 0) {
            key += '-';
        }
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
};

require('dotenv').config(); 

client.login(process.env.BOT_TOKEN);  
