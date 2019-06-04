// Licensed to the StackStorm, Inc ('StackStorm') under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Description:
//   StackStorm hubot integration
//
// Dependencies:
//
//
// Configuration:
//   ST2_API_URL - FQDN + port to StackStorm endpoint
//   ST2_ROUTE - StackStorm notification route name
//   ST2_COMMANDS_RELOAD_INTERVAL - Reload interval for commands
//
// Notes:
//   Command list is automatically generated from StackStorm ChatOps metadata
//

"use strict";

var _ = require('lodash'),
  util = require('util'),
  env = _.clone(process.env),
  Promise = require('rsvp').Promise,
  utils = require('../lib/utils.js'),
  slack_monkey_patch = require('../lib/slack_monkey_patch.js'),
  formatCommand = require('../lib/format_command.js'),
  formatData = require('../lib/format_data.js'),
  postData = require('../lib/post_data.js'),
  CommandFactory = require('../lib/command_factory.js'),
  st2client = require('st2client'),
  uuid = require('uuid')
  ;

// Setup the Environment
env.ST2_API_URL = env.ST2_API || env.ST2_API_URL || 'http://localhost:9101';
env.ST2_ROUTE = env.ST2_ROUTE || null;
env.ST2_WEBUI_URL = env.ST2_WEBUI_URL || null;

// Optional authentication info
env.ST2_AUTH_USERNAME = env.ST2_AUTH_USERNAME || null;
env.ST2_AUTH_PASSWORD = env.ST2_AUTH_PASSWORD || null;

// Optional authentication token
env.ST2_AUTH_TOKEN = env.ST2_AUTH_TOKEN || null;

// Optional API key
env.ST2_API_KEY = env.ST2_API_KEY || null;

// slack attachment colors
env.ST2_SLACK_SUCCESS_COLOR = env.ST2_SLACK_SUCCESS_COLOR || 'dfdfdf';
env.ST2_SLACK_FAIL_COLOR = env.ST2_SLACK_FAIL_COLOR || 'danger';

// Optional, if not provided, we infer it from the API URL
env.ST2_AUTH_URL = env.ST2_AUTH_URL || null;

// Optional, if not provided, we infer it from the API URL
env.ST2_STREAM_URL = env.ST2_STREAM_URL || null;

// Command reload interval in seconds
env.ST2_COMMANDS_RELOAD_INTERVAL = parseInt(env.ST2_COMMANDS_RELOAD_INTERVAL || 120, 10);

// Cap message length to a certain number of characters.
env.ST2_MAX_MESSAGE_LENGTH = parseInt(env.ST2_MAX_MESSAGE_LENGTH || 500, 10);

// Constants
// Fun human-friendly commands. Use %s for payload output.
var START_MESSAGES = [
  "I'll take it from here! Your execution ID for reference is %s",
  "Got it! Remember %s as your execution ID",
  "I'm on it! Your execution ID is %s",
  "Let me get right on that. Remember %s as your execution ID",
  "Always something with you. :) I'll take care of that. Your ID is %s",
  "I have it covered. Your execution ID is %s",
  "Let me start up the machine! Your execution ID is %s",
  "I'll throw that task in the oven and get cookin'! Your execution ID is %s",
  "Want me to take that off your hand? You got it! Don't forget your execution ID: %s",
  "River Tam will get it done with her psychic powers. Your execution ID is %s"
];

var ERROR_MESSAGES = [
  "I'm sorry, Dave. I'm afraid I can't do that. {~} %s"
];

var TWOFACTOR_MESSAGE = "This action requires two-factor auth! Waiting for your confirmation.";


module.exports = function(robot) {
  slack_monkey_patch.patchSendMessage(robot);

  if (env.ST2_API) {
    robot.logger.warning("ST2_API is deprecated and will be removed in a future releases. Instead, please use the ST2_API_URL environment variable.");
  }
  var _stream = null,
    self = this,
    promise = Promise.resolve(),
    url = utils.parseUrl(env.ST2_API_URL),
    opts = {
      protocol: url.protocol,
      host: url.hostname,
      port: url.port,
      prefix: url.path,
      rejectUnauthorized: false
    };

  if (env.ST2_STREAM_URL) {
    var stream_url = utils.parseUrl(env.ST2_STREAM_URL);
    opts.stream = {
      protocol: stream_url.protocol,
      host: stream_url.hostname,
      port: stream_url.port,
      prefix: stream_url.path
    };
  }

  var api_client = st2client(opts);

  if (env.ST2_API_KEY) {
    api_client.setKey({ key: env.ST2_API_KEY });
  } else if (env.ST2_AUTH_TOKEN) {
    api_client.setToken({ token: env.ST2_AUTH_TOKEN });
  }

  function logErrorAndExit(err, res) {
    if (err) {
      robot.logger.error(err.stack);
    }
    if (res) {
      res.send(JSON.stringify({
        "status": "failed",
        "msg": "An error occurred trying to post the message:\n" + err
      }));
    }

    stop();
  }

  function authenticate() {
    api_client.removeListener('expiry', authenticate);

    // API key gets precedence 1
    if (env.ST2_API_KEY) {
      robot.logger.info('Using ST2_API_KEY as authentication. Expiry will lead to bot exit.');
      return Promise.resolve();
    }
    // Auth token gets precedence 2
    if (env.ST2_AUTH_TOKEN) {
      robot.logger.info('Using ST2_AUTH_TOKEN as authentication. Expiry will lead to bot exit.');
      return Promise.resolve();
    }

    robot.logger.info('Requesting a token...');

    var url = utils.parseUrl(env.ST2_AUTH_URL);

    var auth_client = st2client({
      auth: {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port,
        prefix: url.path
      }
    });

    return auth_client.authenticate(env.ST2_AUTH_USERNAME, env.ST2_AUTH_PASSWORD)
      .then(function (token) {
        robot.logger.info('Token received. Expiring ' + token.expiry);
        api_client.setToken(token);
        auth_client.on('expiry', authenticate);
      })
      .catch(function (err) {
        logErrorAndExit(err);
      });
  }

  if (env.ST2_API_KEY || env.ST2_AUTH_TOKEN || env.ST2_AUTH_USERNAME || env.ST2_AUTH_PASSWORD) {
    // If using username and password then all are required.
    if ((env.ST2_AUTH_USERNAME || env.ST2_AUTH_PASSWORD) &&
        !(env.ST2_AUTH_USERNAME && env.ST2_AUTH_PASSWORD && env.ST2_AUTH_URL)) {
      robot.logger.error('Environment variables ST2_AUTH_USERNAME, ST2_AUTH_PASSWORD and ST2_AUTH_URL should only be used together.');
      stop();
    }
    promise = authenticate();
  }

  // Pending 2-factor auth commands
  if (env.HUBOT_2FA) {
    var twofactor = {};
    robot.logger.info('Two-factor auth is enabled');
  }

  // factory to manage commands
  var command_factory = new CommandFactory(robot);

  // formatter to manage per adapter message formatting.
  var formatter = formatData.getFormatter(robot.adapterName, robot);

  // handler to manage per adapter message post-ing.
  var postDataHandler = postData.getDataPostHandler(robot.adapterName, robot, formatter);

  var loadCommands = function(opts) {
    robot.logger.info('Loading commands....');

    var opts = Object.assign({exitOnFailure: false}, opts);

    api_client.actionAlias.list()
      .then(function (aliases) {
        // Remove all the existing commands
        command_factory.removeCommands();

        _.each(aliases, function (alias) {
          var name = alias.name;
          var formats = alias.formats;
          var description = alias.description;

          if (alias.enabled === false) {
            return;
          }

          if (!formats || formats.length === 0) {
            robot.logger.error('No formats specified for command: ' + name);
            return;
          }

          _.each(formats, function (format) {
            var command = formatCommand(robot.logger, name, format.display || format, description);
            command_factory.addCommand(command, name, format.display || format, alias,
                                       format.display ? utils.DISPLAY : false);

            _.each(format.representation, function (representation) {
              command = formatCommand(robot.logger, name, representation, description);
              command_factory.addCommand(command, name, representation, alias, utils.REPRESENTATION);
            });
          });
        });

        robot.logger.info(command_factory.st2_hubot_commands.length + ' commands are loaded');
      })
      .catch(function (err) {
        var error_msg = 'Failed to retrieve commands from ' + env.ST2_API_URL + ' ';
        if (opts.exitOnFailure) {
          logErrorAndExit(err);
        }
      });
  };

  var sendAck = function (msg, res) {
    var history_url = utils.getExecutionHistoryUrl(res.execution);
    var history = history_url ? util.format(' (details available at %s)', history_url) : '';

    if (res.actionalias && res.actionalias.ack) {
      if (res.actionalias.ack.enabled === false) {
        return;
      } else if (res.actionalias.ack.append_url === false) {
        history = '';
      }
    }

    if (res.message) {
      return msg.send(res.message + history);
    }

    var message = util.format(_.sample(START_MESSAGES), res.execution.id);
    return msg.send(message + history);
  };

  var sendAliasExecutionRequest = function (msg, payload) {
    robot.logger.debug('Sending command payload:', JSON.stringify(payload));

    api_client.aliasExecution.create(payload)
      .then(function (res) { sendAck(msg, res); })
      .catch(function (err) {
        // Compatibility with older StackStorm versions
        if (err.status === 200) {
          return sendAck(msg, { execution: { id: err.message } });
        }
        robot.logger.error('Failed to create an alias execution:', err);
        var addressee = formatter.normalizeAddressee(msg);
        var message = util.format(_.sample(ERROR_MESSAGES), err.message);
        if (err.requestId) {
          message = util.format(
            message,
            util.format('; Use request ID %s to grep st2 api logs.', err.requestId));
        }
        postDataHandler.postData({
          whisper: false,
          user: addressee.name,
          channel: addressee.room,
          message: message,
          extra: {
            color: '#F35A00'
          }
        });
        throw err;
      });
  };

  var executeCommand = function(msg, command_name, format_string, command, action_alias) {
    var addressee = formatter.normalizeAddressee(msg);
    var payload = {
      'name': command_name,
      'format': format_string,
      'command': command,
      'user': addressee.name,
      'source_channel': addressee.room,
      'source_context': msg.envelope,
      'notification_route': env.ST2_ROUTE || 'hubot'
    };

    if (utils.enable2FA(action_alias)) {
      var twofactor_id = uuid.v4();
      robot.logger.debug('Requested an action that requires 2FA. Guid: ' + twofactor_id);
      msg.send(TWOFACTOR_MESSAGE);
      api_client.executions.create({
        'action': env.HUBOT_2FA,
        'parameters': {
          'uuid': twofactor_id,
          'user': addressee.name,
          'channel': addressee.room,
          'hint': action_alias.description
        }
      });
      twofactor[twofactor_id] = {
        'msg': msg,
        'payload': payload
      };
    } else {
      sendAliasExecutionRequest(msg, payload);
    }
  };

  robot.respond(/([\s\S]+?)$/i, function(msg) {
    var command, result, command_name, format_string, action_alias;

    // Normalize the command and remove special handling provided by the chat service.
    // e.g. slack replace quote marks with left double quote which would break behavior.
    command = formatter.normalizeCommand(msg.match[1]);

    result = command_factory.getMatchingCommand(command);

    if (!result) {
      // No command found
      return;
    }

    command_name = result[0];
    format_string = result[1];
    action_alias = result[2];

    executeCommand(msg, command_name, format_string, command, action_alias);
  });

  robot.router.post('/hubot/st2', function(req, res) {
    var data;

    try {
      if (req.body.payload) {
        data = JSON.parse(req.body.payload);
      } else {
        data = req.body;
      }
      postDataHandler.postData(data);

      res.send(JSON.stringify({
        "status": "completed",
        "msg": "Message posted successfully"
      }));
    } catch (err) {
      logErrorAndExit(err, res)
    }
  });

  var commands_load_interval;

  function start() {
    robot.error(logErrorAndExit);

    api_client.stream.listen().catch(function (err) {
      exitProcessWithLog('Unable to connect to stream: ', err);
    }).then(function (source) {
      source.onerror = function (err) {
        // TODO: squeeze a little bit more info out of eventsource.js
        logErrorAndExit(err);
      };
      source.addEventListener('st2.announcement__chatops', function (e) {
        var data;

        robot.logger.debug('Chatops message received:', e.data);

        if (e.data) {
          data = JSON.parse(e.data).payload;
        } else {
          data = e.data;
        }

        postDataHandler.postData(data);
      });

      if (env.HUBOT_2FA) {
        source.addEventListener('st2.announcement__2fa', function (e) {
          var data;

          robot.logger.debug('Successfull two-factor auth:', e.data);

          if (e.data) {
            data = JSON.parse(e.data).payload;
          } else {
            data = e.data;
          }

          var executionData = twofactor[data.uuid];
          sendAliasExecutionRequest(executionData.msg, executionData.payload);
          delete twofactor[data.uuid];
        });
      }
    });

    // Initial command loading
    loadCommands({exitOnFailure: true});

    // Add an interval which tries to re-load the commands
    commands_load_interval = setInterval(loadCommands.bind(self), (env.ST2_COMMANDS_RELOAD_INTERVAL * 1000));

    // Install SIGUSR2 handler which reloads the command
    install_sigusr2_handler();
  }

  function stop() {
    clearInterval(commands_load_interval);
    api_client.stream.listen().then(function (source) {
      source.removeAllListeners();
      source.close();
    });

    robot.shutdown();
    process.exit(1);
  }

  function install_sigusr2_handler() {
    process.on('SIGUSR2', function() {
      loadCommands();
    });
  }

  // Authenticate with StackStorm backend and then call start.
  // On a failure to authenticate log the error and quit.
  return promise.then(function () {
    start();
    return stop;
  });
};
