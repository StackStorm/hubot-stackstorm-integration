/*
 Licensed to the StackStorm, Inc ('StackStorm') under one or more
 contributor license agreements.  See the NOTICE file distributed with
 this work for additional information regarding copyright ownership.
 The ASF licenses this file to You under the Apache License, Version 2.0
 (the "License"); you may not use this file except in compliance with
 the License.  You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
limitations under the License.
*/

"use strict";

var _ = require('lodash');
var utils = require('./utils.js');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var formatCommand = function(name, format, description) {
  var context, template_str, compiled_template, command;

  if (!format) {
    throw (Error('format should be non-empty.'));
  }

  context = {
    'format': format,
    'description': description
  };

  template_str = '${format} - ${description}';
  compiled_template = _.template(template_str);
  command = compiled_template(context);

  return command;
};

var getRegexForFormatString = function (format) {
  var extra_params, regex_str, regex;

  // Note: We replace format parameters with ([\s\S]+?) and allow arbitrary
  // number of key=value pairs at the end of the string
  // Format parameters with default value {{param=value}} are allowed to
  // be skipped.
  // Note that we use "[\s\S]" instead of "." to allow multi-line values
  // and multi-line commands in general.
  extra_params = '(\\s+(\\S+)\\s*=("([\\s\\S]*?)"|\'([\\s\\S]*?)\'|({[\\s\\S]*?})|(\\S+))\\s*)*';
  regex_str = format.replace(/(\s*){{\s*\S+\s*=\s*(?:({.+?}|.+?))\s*}}(\s*)/g, '\\s*($1([\\s\\S]+?)$3)?\\s*');
  regex_str = regex_str.replace(/\s*{{.+?}}\s*/g, '\\s*([\\s\\S]+?)\\s*');
  regex = new RegExp('^\\s*' + regex_str + extra_params + '\\s*$', 'i');
  return regex;
};

function CommandFactory(robot) {
  this.robot = robot;
  EventEmitter.call(this);
}

util.inherits(CommandFactory, EventEmitter);

CommandFactory.prototype.addCommand = function (action_alias, messaging_handler) {
  var self = this;

  if (action_alias.enabled === false) {
    return;
  }

  if (!action_alias.formats || action_alias.formats.length === 0) {
    self.robot.logger.error('No formats specified for command: ' + action_alias.name);
    return;
  }

  var regexes = [];
  var commands_regex_map = {};
  var action_alias_name = action_alias.name;

  _.each(action_alias.formats, function (format) {
    var formatted_string = formatCommand(action_alias.name, format.display || format, action_alias.description);
    var compiled_template = _.template('hubot ${command}');
    self.robot.commands.push(compiled_template({ robotName: self.robot.name, command: formatted_string }));

    if (format.display) {
      _.each(format.representation, function (representation) {
        commands_regex_map[formatted_string] = getRegexForFormatString(representation);
      });
    } else {
      commands_regex_map[formatted_string] = getRegexForFormatString(format);
    }
  });

  var format_strings = Object.keys(commands_regex_map);

  self.robot.listen(function (msg) {
    var i, format_string, regex;
    var command = messaging_handler.normalizeCommand(msg.text);
    for (i = 0; i < format_strings.length; i++) {
      format_string = format_strings[i];
      regex = commands_regex_map[format_string];
      if (regex.test(command)) {
        msg['st2_command_format_string'] = format_string;
        msg['normalized_command'] = command;
        return true;
      }
    }
    return false;
  }, { id: action_alias_name }, function (msg) {
    self.emit('st2.command_match', {
      msg: msg,
      alias_name: action_alias_name,
      command_format_string: msg.message['st2_command_format_string'],
      command: msg.message['normalized_command'],
      addressee: messaging_handler.normalizeAddressee(msg)
    });
  });
};

module.exports = CommandFactory;
