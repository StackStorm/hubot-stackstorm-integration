Changelog
=========

in development
--------------
* Use Github Actions for tests.
* Remove TravisCI.

0.12.1
------

* Allow responding in a thread for the ack/result in slack (improvement) #237

0.12.0
------

* Clean slack-injected latin1 nbsp character (/xA0) from command to improve command recognition.
  Slack will sometimes replace a space with /xA0, often near something that renders as a link.
  Now, when someone copies that command, they can paste it and still have hubot recognize it.
  (improvement) #214

0.11.2
------

* Update ``lodash`` and ``st2client`` dependencies (improvement) #215

0.11.1
------

* Update ``ini`` dependency to 1.3.8 (improvement) #212

0.11.0
------

* Remove HipChat adapter [PR #207] (change)

0.10.4
------

* Update st2client.js to 1.2.3 [PR #204] (change)
* Add mversion to devDependencies (change)

0.10.3
------

* Update st2client.js to 1.2.2 [PR #203] (change)

0.10.2
------

* Fix the Cisco Spark/Webex Teams adapter [PR #200] (bug fix)
* Fix mocha tests to return a non-zero exit status if tests fail [PR #201] (bug fix)

0.10.1
------

* Create npm-shrinkwrap.json with only production dependencies

0.10.0
------

* Move babel-eslint dependency to devDependencies [PR #180] (bug fix)
* Small refactor and more tests (for ``scripts/stackstorm.js``) [PR #185] (improvement)
* Refactor chat providers into their own modules [PR #186] (improvement)
* Modernize directory structure to be more consistent with other hubot plugins [PR #186, PR #191]
  (improvement)
* Split out the functionality of ``src/stackstorm.js`` into ``stackstorm_api.js`` and refactor it
  to be a JS old style class with a wrapper [PR #187, PR #190] (improvement)
* Fix the Mattermost adapter to use the ``adapter.post`` function instead of emitting the
  ``slack-attachment`` event [PR #192] (bug fix)

0.9.6
-----
* Don't consider failed alias execution as a critical reason to exit hubot (bug fix)

0.9.5
-----
* Exit hubot on invalid, expired ``ST2_API_KEY`` / ``ST2_AUTH_TOKEN`` or any other Unauthorized
  response from st2 server (bug fix)
* When st2 username/password is used, re-generate st2 auth token in advance, giving enough time for
  request to complete, st2client.js (bug fix)

0.9.4
-----
* Exit hubot on unhandled promise rejections and uncaught exceptions, usually caused by
  unrecoverable errors (bug fix)
* Add pagination support for action aliases - fixes #158 (bug fix)

0.9.3
-----
* Add initial support for Microsoft Teams via BotFramework (new feature)
* Add unit tests for all adapters (improvement)

0.9.2
-----
* Rename ENV variable ``ST2_API`` -> ``ST2_API_URL`` for consistency, keep ``ST2_API`` for
  backwards compatibility (improvement)

0.9.1
-----
* Erroneous version

0.9.0
-----
* Remove support for Yammer (removal)
* Update hubot to 3.1.1 (change)
* Migrate to coffeescript 2.3.2 and coffee-register 2.2.0 (change)
* Update supported version of node to >= 8, <= 10 (change)
* Add coverage support with nyc (change)

0.8.0
-----
* Break up messages multiple ways (if necessary) to avoid Slack API limits (improvement)
* Add support for specifying Stream URL (new feature)
* Update st2client to 1.1.1 (improvement)
* Add support for button attachments in mattermost adapter (improvement)
* Drop Node.js 0.12 support (change)

0.7.0
-----
* Add RocketChat support (new feature)

0.6.0
-----
* Update Slack to use new chat postMessage API from 'hubot-slack' v4 (new feature)

0.5.1
-----
* Update uuid to version 3.0.0 (improvement)
* Add support for sending file attachments via the extra dict to the spark adapter (improvement)

0.5.0
-----
* Mattermost support (new feature)

0.3.0
-----
* Switched to st2client.js (new feature)
* Chatops announcements (new feature)
* Custom formatting for results (new feature)
* Disabling ack and results for specific aliases (new feature)
* Connect using API keys when provided (new feature)
* Better parameters parsing (improvement)
* Multi-line and milti-word matching (improvement)
* Start renewing tokens based on expiry time (improvement)

0.2.6
-----
* Results are posted to slack as attachments with appropriate colors. (Feature - thomaspicquet)

0.2.5
-----
* Bring back support for spaces in commands (regression fix)
* Handle slack special quotes (bug fix)

0.2.4
-----

* include content-type in headers

0.2.3
-----

* fixes to command factory regex (amaline)
* rename notification channel to route.
* fix command normalization by using global string replace.

0.2.2
-----

* Log a better error message if we fail to load the commands because of the StackStorm API
  unavailability.

0.2.1
-----

* Switched to use StackStorm API v1 instead of exp.

0.2.0
-----

* Preserve user supplied casing for chat literals. (bug-fix)
* Refactor formatting code to handle various adapter better. Tested support for
  slack, hubot and xmpp.
* Message truncation over 500 characters to preserve chat context. HipChat does its
  own truncation so depending on that.
* Authentication with StackStorm is now skipped in case auth is disabled. (bug-fix)
* Best attempt to include execution details. (new feature)
* Rather than a single message response to an execution comprises of multiple small
  messages. This allows formatting & truncation to be handled separately. (new feature)

0.1.2
-----
* Support Hipchat channel type and message format (@Itxaka)
* hubot-stackstorm does not cause hubot to quit on authentication failure.
* Authentication code is resilient to unavailability or StackStorm service. Will retry a
  configurable number of times.

0.1.1
-----

* Add support for including a link to the execution details in the WebUI when an execution has
  been scheduled and when it has finished.
* Fix a bug with parsing of port from the API and AUTH URLs.

0.1.0
-----

* Initial release.
