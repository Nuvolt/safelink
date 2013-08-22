/**
 *
 * Copyright 2013 Joel Grenon
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function(){

    module.exports = {
        'agent-connect' : require('./agent-connect'),
        'agent-disconnect' : require('./agent-disconnect'),
        'heartbeat' : require('./heartbeat'),
        'retrieve-pending-commands': require('./retrieve-pending-commands'),
        "command-response" : require('./post-command-response'),
        "command-error": require('./handle-command-error'),
        'subscribe': require('./subscribe'),
        'unsubscribe': require('./unsubscribe'),
        'retrieve-pending-events': require('./retrieve-pending-events'),
        'broadcast': require('./broadcast'),
        'execute-command': require('./execute-command')
    };

})();
