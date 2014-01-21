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

module.exports = function(request) {
    var _this = this;
    this.log.trace(request, "Handling execute-command-on command");

    if(request.uuid) {
        request.options = request.options || {};
        request.options.uuid = request.uuid;
    }

    return this.executeOnAgent(request.agentId, request.commandKey, request.payload, request.options).progress(function(progress){
        _this.log.debug("Emitting command %s(%s) progress", progress.cmd.key, progress.cmd.id, progress.data);
        _this.emitTo(request.id, 'command-progress', progress);
    });
};
