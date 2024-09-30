// Copyright 2019 Extreme Networks, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
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
  utils = require('./utils.js'),
  formatCommand = require('./format_command.js'),
  CommandFactory = require('./command_factory.js'),
  adapters = require('./adapters'),
  st2client = require('st2client'),
  uuid = require('uuid');

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


function StackStorm(robot) {
  var self = this;

  self.robot = robot;

  // factory to manage commands
  self.command_factory = new CommandFactory(self.robot);

  // adapter - specific to each chat provider
  self.adapter = adapters.getAdapter(self.robot.adapterName, self.robot);

  self.commands_load_interval = null;
  self.st2stream = null;

  self.two_factor_authorization_enabled = env.HUBOT_2FA || false;


  // Makes the script crash on unhandled rejections instead of ignoring them and keep running.
  // Usually happens when trying to connect to a nonexistent instances or similar unrecoverable issues.
  // In the future Node.js versions, promise rejections that are not handled will terminate the process with a non-zero exit code.
  process.on('unhandledRejection', function (err) {
    throw err;
  });

  // Handle uncaught exceptions, log error and terminate hubot if one occurs
  self.robot.error(function (err, res) {
    if (err) {
      self.robot.logger.error(err.stack || JSON.stringify(err));
    }
    if (res) {
      res.send(JSON.stringify({
        "status": "failed",
        "msg": "An error occurred trying to post the message:\n" + err
      }));
    }

    self.robot.logger.info('Hubot will shut down ...');
    self.robot.shutdown();
  });

  self.robot.respond(/([\s\S]+?)$/i, function (msg) {
    var command, result;

    // Normalize the command and remove special handling provided by the chat service.
    // e.g. slack replace quote marks with left double quote which would break behavior.
    command = self.adapter.normalizeCommand(msg.match[1]);
    result = self.command_factory.getMatchingCommand(command);

    if (!result) {
      // No command found
      return;
    }

    var [command_name, format_string, action_alias] = result;

    self.executeCommand(msg, command_name, format_string, command, action_alias);
  });

  self.robot.router.post('/hubot/st2', function (req, res) {
    var data;

    try {
      if (req.body.payload) {
        data = JSON.parse(req.body.payload);
      } else {
        data = req.body;
      }
      self.adapter.postData(data);

      res.send('{"status": "completed", "msg": "Message posted successfully"}');
    } catch (e) {
      self.robot.logger.error("Unable to decode JSON: " + e);
      self.robot.logger.error(e.stack);
      res.send('{"status": "failed", "msg": "An error occurred trying to post the message: ' + e + '"}');
    }
  });


  if (env.ST2_API) {
    self.robot.logger.warning("ST2_API is deprecated and will be removed in a future releases. Instead, please use the ST2_API_URL environment variable.");
  }

  if (self.two_factor_authorization_enabled) {
    self.twofactor = {};
    self.robot.logger.info('Two-factor auth is enabled');
  }

  var url = utils.parseUrl(env.ST2_API_URL),
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

  self.auth_client = null
  self.api_client = st2client(opts);

  if (env.ST2_API_KEY) {
    self.api_client.setKey({
      key: env.ST2_API_KEY
    });
  } else if (env.ST2_AUTH_TOKEN) {
    self.api_client.setToken({
      token: env.ST2_AUTH_TOKEN
    });
  }

  if (env.ST2_API_KEY || env.ST2_AUTH_TOKEN || env.ST2_AUTH_USERNAME || env.ST2_AUTH_PASSWORD) {
    // If using username and password then all are required.
    if ((env.ST2_AUTH_USERNAME || env.ST2_AUTH_PASSWORD) &&
      !(env.ST2_AUTH_USERNAME && env.ST2_AUTH_PASSWORD && env.ST2_AUTH_URL)) {
      throw new Error('Env variables ST2_AUTH_USERNAME, ST2_AUTH_PASSWORD and ST2_AUTH_URL should only be used together.');
    }
  }
};


// This is a privileged method, and is not shared amongst StackStorm objects.
// It is a method on every StackStorm _object_. Luckily, this should only be
// created once.
// For more information, see:
// https://stackoverflow.com/a/2294252
StackStorm.prototype.authenticate = function () {
  var self = this;

  self.api_client.removeListener('expiry', self.authenticate.bind(self));

  // API key gets precedence 1
  if (env.ST2_API_KEY) {
    self.robot.logger.info('Using ST2_API_KEY as authentication. Expiry will lead to bot exit.');
    return Promise.resolve();
  }
  // Auth token gets precedence 2
  if (env.ST2_AUTH_TOKEN) {
    self.robot.logger.info('Using ST2_AUTH_TOKEN as authentication. Expiry will lead to bot exit.');
    return Promise.resolve();
  }

  self.robot.logger.info('Requesting a token...');

  var url = utils.parseUrl(env.ST2_AUTH_URL);

  self.auth_client = st2client({
    auth: {
      protocol: url.protocol,
      host: url.hostname,
      port: url.port,
      prefix: url.path
    }
  });

  return self.auth_client.authenticate(env.ST2_AUTH_USERNAME, env.ST2_AUTH_PASSWORD)
    .then(function (token) {
      self.robot.logger.info('Token received. Expiring ' + token.expiry);
      self.api_client.setToken(token);
      self.auth_client.on('expiry', self.authenticate.bind(self));
    })
    .catch(function (err) {
      self.robot.logger.error('Failed to authenticate: ' + err.message);

      throw err;
    });
};

StackStorm.prototype.loadCommands = function () {
  var self = this;

  self.robot.logger.info('Loading commands....');

  self.api_client.actionAlias.list({
      limit: -1
    })
    .then(function (aliases) {
      // Remove all the existing commands
      self.command_factory.removeCommands();

      _.each(aliases, function (alias) {
        var name = alias.name;
        var formats = alias.formats;
        var description = alias.description;

        if (alias.enabled === false) {
          return;
        }

        if (!formats || formats.length === 0) {
          self.robot.logger.error('No formats specified for command: ' + name);
          return;
        }

        _.each(formats, function (format) {
          var command = formatCommand(self.robot.logger, name, format.display || format, description);
          self.command_factory.addCommand(command, name, format.display || format, alias,
            format.display ? utils.DISPLAY : false);

          _.each(format.representation, function (representation) {
            command = formatCommand(self.robot.logger, name, representation, description);
            self.command_factory.addCommand(command, name, representation, alias, utils.REPRESENTATION);
          });
        });
      });

      self.robot.logger.info(self.command_factory.st2_hubot_commands.length + ' commands are loaded');
    })
    .catch(function (err) {
      self.robot.logger.error(util.format('Failed to retrieve commands from "%s": %s', env.ST2_API_URL, err.message));
      if (err.status === 401 || err.message.includes('Unauthorized')) {
        throw err;
      }
    });
};

StackStorm.prototype.sendAck = function (msg, res) {
  var self = this;

  var history_url = utils.getExecutionHistoryUrl(res.execution);
  var history = history_url ? util.format(' (details available at %s)', history_url) : '';

  if (res.actionalias && res.actionalias.ack) {
    if (res.actionalias.ack.enabled === false) {
      return;
    } else if (res.actionalias.ack.append_url === false) {
      history = '';
    }
  }

  // If ack.extra.slack.thread_response is set in the action-alias definition,
  // then we will thread the ACK response message (SLACK ONLY)
  if (res.extra && res.extra.slack && res.extra.slack.thread_response) {
    msg.message.thread_ts = msg.message.id;
  }

  if (res.message) {
    return msg.send(res.message + history);
  }

  var message = util.format(_.sample(START_MESSAGES), res.execution.id);
  return msg.send(message + history);
};

StackStorm.prototype.sendAliasExecutionRequest = function (msg, payload) {
  var self = this;

  self.robot.logger.debug('Sending command payload:', JSON.stringify(payload));

  self.api_client.aliasExecution.create(payload)
    .then(function (res) {
      self.sendAck(msg, res);
    })
    .catch(function (err) {
      // Compatibility with older StackStorm versions
      if (err.status === 200) {
        return self.sendAck(msg, {
          execution: {
            id: err.message
          }
        });
      }
      self.robot.logger.error('Failed to create an alias execution:', err);
      var addressee = self.adapter.normalizeAddressee(msg);
      var message = util.format(_.sample(ERROR_MESSAGES), err.message);
      if (err.requestId) {
        message = util.format(
          message,
          util.format('; Use request ID %s to grep st2 api logs.', err.requestId));
      }
      self.adapter.postData({
        whisper: false,
        user: addressee.name,
        channel: addressee.room,
        message: message,
        extra: {
          color: '#F35A00'
        }
      });
    });
};

StackStorm.prototype.executeCommand = function (msg, command_name, format_string, command, action_alias) {
  var self = this;

  var addressee = self.adapter.normalizeAddressee(msg);
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
    self.robot.logger.debug('Requested an action that requires 2FA. Guid: ' + twofactor_id);
    msg.send(TWOFACTOR_MESSAGE);
    self.api_client.executions.create({
      'action': self.two_factor_authorization_enabled,
      'parameters': {
        'uuid': twofactor_id,
        'user': addressee.name,
        'channel': addressee.room,
        'hint': action_alias.description
      }
    });
    self.twofactor[twofactor_id] = {
      'msg': msg,
      'payload': payload
    };
  } else {
    self.sendAliasExecutionRequest(msg, payload);
  }
};

StackStorm.prototype.install_sigusr2_handler = function () {
  var self = this;

  process.on('SIGUSR2', function () {
    self.robot.logger.debug("Caught SIGUSR2, reloading commands");
    self.loadCommands();
  });
};

StackStorm.prototype.start = function () {
  var self = this;

  self.api_client.stream.listen().catch(function (err) {
    self.robot.logger.error('Unable to connect to stream:', err);
  }).then(function (st2stream) {
    // Save the connection stream object
    self.st2stream = st2stream;

    self.st2stream.onerror = function (err) {
      // TODO: squeeze a little bit more info out of evensource.js
      self.robot.logger.warning('Stream error:', err);
      if (err.status === 401) {
        throw err;
      }
    };
    self.st2stream.addEventListener('st2.announcement__chatops', function (e) {
      var data;

      self.robot.logger.debug('Chatops message received:', e.data);

      if (e.data) {
        data = JSON.parse(e.data).payload;
      } else {
        data = e.data;
      }


      self.adapter.postData(data);
    });

    if (self.two_factor_authorization_enabled) {
      st2stream.addEventListener('st2.announcement__2fa', function (e) {
        var data;

        self.robot.logger.debug('Successfull two-factor auth:', e.data);

        if (e.data) {
          data = JSON.parse(e.data).payload;
        } else {
          data = e.data;
        }


      });
    }
  });

  // Add an interval which tries to re-load the commands
  self.commands_load_interval = setInterval(self.loadCommands.bind(self), (env.ST2_COMMANDS_RELOAD_INTERVAL * 1000));

  // Initial command loading
  self.loadCommands();

  // Install SIGUSR2 handler which reloads the command
  self.install_sigusr2_handler();
};

StackStorm.prototype.stop = function () {
  var self = this;

  clearInterval(self.commands_load_interval);
  self.api_client.stream.listen().then(function (second_st2stream) {
    second_st2stream.removeAllListeners();
    second_st2stream.close();
  });
};


module.exports = StackStorm;
