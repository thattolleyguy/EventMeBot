var Discord = require('discord.io');
var logger = require('winston');
var auth = require('./auth.json');
const sqlite3 = require('sqlite3').verbose();


// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console, {
    colorize: true
});
logger.level = 'debug';

var db = new sqlite3.Database('eventme.db', (err) => {
    if (err) {
        logger.error("Unable to initialize database");
    }
    logger.info('Connected to db');
})

const dbinit = true;
if (dbinit) {
    db.serialize(() => {
        db.run('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, name TEXT, channelId TEXT, date INTEGER, description TEXT, UNIQUE(name, channelId))')
            .run('CREATE TABLE IF NOT EXISTS responses (eventId INTEGER, userName TEXT, response TEXT, additionalGuests INTEGER, PRIMARY KEY(eventId, userName))');
    })
}



// Initialize Discord Bot
var bot = new Discord.Client({
    token: auth.token,
    autorun: true
});
bot.on('ready', function (evt) {
    logger.info('Connected');
    logger.info('Logged in as: ');
    logger.info(bot.username + ' - (' + bot.id + ')');
});

function saveResponse(response, user, eventId, channelID, eventName, additionalGuests) {
    db.run('REPLACE INTO responses (eventId, userName, response, additionalGuests) VALUES (?,?,?,?)', [eventId, user, response, additionalGuests], () => {
        var message = user + ' responded ' + response + ' to event ' + eventName;
        if (additionalGuests > 0) {
            message += ' and bringing ' + additionalGuests + ' guests';
        }
        bot.sendMessage({
            to: channelID,
            message: message
        })
    });
}

function processResponseMessage(response, args, user, channelId) {

    var eventName;
    var additionalGuests = 0;
    if (args.length == 2) {
        eventName = args[0];
        additionalGuests = args[1]
    } else if (args.length == 1) {
        var parsed = parseInt(args[0], 10);
        if (!isNaN(parsed)) {
            additionalGuests = parsed;
        } else {
            eventName = args[0];
        }
    }

    if (eventName) {
        db.get('SELECT * FROM events WHERE name=? AND channelId=?', [eventName, channelId], (err, row) => {
            if (row) {
                // Check to see if the event exists
                saveResponse(response, user, row.id, channelId, row.name, additionalGuests);
            }

        });
    } else {
        db.get("SELECT * FROM events WHERE channelId=? ORDER BY id DESC LIMIT 1", [channelId], (err, row) => {
            saveResponse(response, user, row.id, channelId, row.name, additionalGuests);
        });

    }
}

bot.on('message', function (userName, userId, channelId, message, evt) {
    logger.info(message);
    logger.info(evt);
    logger.info(userId);
    if (userId === bot.id) {
        return;
    }
    // Our bot needs to know if it will execute a command
    // It will listen for messages that will start with `!`
    if (message.substring(0, 1) == '!') {
        var args = message.substring(1).split(' ');
        var cmd = args[0];

        args = args.slice(1);
        switch (cmd) {
            // !ping
            case 'ping':
                bot.sendMessage({
                    to: channelId,
                    message: 'Pong!'
                });
                break;
            case 'create':
                // !create name date time description
                var datestring = args[1] + ' ' + args[2];
                var parts = datestring.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
                var datetime = Date.UTC(+parts[3], parts[2] - 1, +parts[1], +parts[4], +parts[5]);
                var name = args[0];
                if (/^\d+$/.test(name)) {
                    bot.sendMessage({
                        to: channelId,
                        message: 'Event Name must contain non-numeric characters'
                    })
                    return;
                }
                var description = args.slice(3).join(' ');
                db.run('INSERT INTO events (name, date, description, channelId) VALUES (?,?,?,?)', [name, datetime, description, channelId], () => {
                    bot.sendMessage({
                        to: channelId,
                        message: name + ' event created!'
                    })
                });
                break;
            case 'in':
            case 'out':

                processResponseMessage(cmd, args, userName, channelId);
                // !out ?eventName
                break;
            case 'events':
                db.all('SELECT * FROM events WHERE channelId=?', [channelId], (err, rows) => {
                    var message;
                    if (rows && rows.length > 0) {
                        message = 'Events for this channel:\n'
                        rows.forEach((row) => {
                            message += (row.name + '\n');
                        })
                    } else {
                        message = 'No events found';
                    }
                    bot.sendMessage({
                        to: channelId,
                        message: message
                    })
                })
                break;
            case 'event':
                db.get('SELECT * FROM events WHERE channelId=? AND name=?', [channelId, args[0]], (err, eventRow) => {
                    db.all('SELECT * FROM responses WHERE eventId = ?', [eventRow.id], (err, rows) => {
                        var message = eventRow.name + '\n';
                        message += ('-'.repeat(eventRow.name.length) + '\n');
                        message += (new Date(eventRow.date) + '\n');
                        message += eventRow.description + '\n\n';
                        message += 'Responses\n------------\n';
                        rows.forEach((row) => {
                            message += (row.userName + ": " + row.response);
                            if (row.additionalGuests > 0) {
                                message += ('+' + row.additionalGuests);
                            }
                            message += '\n';
                        })
                        bot.sendMessage({
                            to: channelId,
                            message: message
                        })
                    })
                })
                break;
            case 'help':
                var destination = userId;
                if (args[0] && args[0] == 'all') {
                    destination = channelId;
                }

                bot.sendMessage({
                    to: destination,
                    message: 'EventMe Bot Commands\n' +
                        '----------------------------\n' +
                        '**!ping** - Test if the bot is running\n' +
                        '**!create <name> <date> <time> <description>** - Create a new event. The date is of the format MM/dd/yyyy. Time is UTC 24 hour format (hh:mm).\n' +
                        '**!in <eventName> <additionalGuests>** - Event name is optional. If you provide it, you will be marked in for that event. If you do not provide it, you will be marked in for the latest created event. Additional guests is optional as well and defaults to 0.\n' +
                        '**!out <eventName>** - Event name is optional. If you provide it, you will be marked out for that event. If you do not provide it, you will be marked out for the latest created event\n' +
                        '**!events** - Get a list of events that have been created.\n' +
                        '**!event <eventName>** - View details of an event and how users have responded.\n' +
                        '**!help** - Display this help.'
                })

                break;

        }
    }
});