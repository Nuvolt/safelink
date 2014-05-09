/*! 
 safelink - v0.10.3 - 2014-05-09
(C) 2014 Joel Grenon. Distributed under the Apache Version 2.0, January 2004. See attached license
*/!function(){var a=require("util"),b=(require("request"),require("q")),c=require("lodash"),d=require("eventemitter3"),e=require("./transports"),f=require("shortid"),g=require("bunyan");require("underscore-query");var h=function(){function h(a){var b=a.id||f.generate();this.layer=new e(c.extend(c.pick(a,"logLevel"),{logName:b+"-transport-layer"})),this.id=b,this.version=a.version||100,this.url=a.endpoint,this.timeout=a.timeout||30,this.websocket=a.websocket||!1,this.log=a.log||g.createLogger({name:b,level:a.logLevel||"info"}),this.heartbeatSpec=a.heartbeat||{interval:30},this.pollingSpec=a.polling||{interval:5},this.commandHandlers=c.defaults(a.commandHandlers||{},{configure:m(this,"configure")}),this.eventHandlers=[{key:"command-progress",scope:this,handler:n}],d.call(this)}function i(a){var d=this;if(a.timeout=a.timeout||d.timeout,d.log.debug("Executing command with timeout ",a.timeout),c.isString(a.payload)){d.log.trace("Automatically converting string payload to object using JSON parse");try{a.payload=JSON.parse(a.payload)}catch(e){d.log.error("Unable to parse command %s(%s) payload. error=",a.id,a.key,e)}}d.log.debug("Looking for installed handle for command %s (%s)",a.id,a.key);var f=this.commandHandlers[a.key];if(f){var g=b.defer();b.nextTick(function(){d.log.trace("Executing command handler",f),c.bind(f,d)(a,g)}),d.log.trace("Waiting for command %s(%s) results for %s seconds",a.id,a.key,d.timeout),b.timeout(g.promise,1e3*a.timeout).then(function(b){d.log.debug("Received command %s(%s) result",a.id,a.key),d.log.trace("Command %s(%s) result = ",a.id,a.key,b);var c=d.layer.send(d,"command-response",{commandId:a.id,result:b});return c.then(function(){d.log.trace("Response for command %s(%s) was successfully posted",a.key,a.id)},function(b){d.log.error("Unable to post command-response for command %s(%s)",a.key,a.id,b)}),c},function(b){d.log.error("Error while processing command %s(%s): ",a.key,a.id,b),d.layer.send(d,"command-error",{commandId:a.id,type:"timeout",error:b})},function(b){d.log.trace("Progress notification received for command %s(%s)",a.key,a.id),d.layer.send(d,"post-command-progress",{commandId:a.id,progress:b},{noResponse:!0})}).catch(function(b){d.log.error("Exception! Error while processing command %s(%s): ",a.key,a.id,b),d.layer.send(d,"command-error",{commandId:a.id,type:"timeout",error:b})})}else d.log.warn("No handler configured for command %s(%s). We assume that a custom event handler has been installed on the 'command' event",a.key,a.id)}function j(){var a,d,e=this;return e.log.debug("Sending heartbeat to our dispatcher"),d=b.fcall(function(){var d={meta:{interval:e.heartbeatSpec.interval}};if(e.heartbeatSpec.payload){if(c.isFunction(e.heartbeatSpec.payload)){e.log.trace("We have a payload generator function");var f=b.defer();if(1===e.heartbeatSpec.payload.length){var g=b.defer();return e.log.debug("Producing deferred payload"),e.heartbeatSpec.payload.call(e.heartbeatSpec.scope||e,g),b.timeout(g.promise,1e3*(e.heartbeatSpec.interval-5)||25e3).then(function(a){e.log.trace(a,"Heartbeat payload produced"),f.resolve(e.layer.send(e,"heartbeat",{payload:a,meta:d}))},function(a){e.log.warn(a,"Unable to produce heartbeat payload. Empty payload will be used",a),f.resolve(e.layer.send(e,"heartbeat",{meta:d}))}).catch(function(a){e.log.warn(a,"Exception! Unable to produce heartbeat payload. Empty payload will be used",a),f.resolve(e.layer.send(e,"heartbeat",{meta:d}))}),f.promise}return e.log.debug("Producing heartbeat payload synchronously"),a=e.heartbeatSpec.payload.call(e.heartbeatSpec.scope||e),e.log.trace(a,"Heartbeat payload produced"),e.layer.send(e,"heartbeat",{payload:a,meta:d})}return e.log.trace(a,"Heartbeat payload produced"),e.layer.send(e,"heartbeat",{payload:e.heartbeatSpec.payload,meta:d})}return e.layer.send(e,"heartbeat",{meta:d})}),d.then(function(a){e.log.debug("Heartbeat successfully sent",a)},function(a){e.log.error("Unable to send heartbeat",a)}).catch(function(a){e.log.error("Exception! Unable to send heartbeat",a)}).finally(function(){e.heartbeatSpec.manual||(e.log.debug("Programming next heartbeat for %d seconds",e.heartbeatSpec.interval),e.nextHeartbeat=setTimeout(function(){e.emit("send-heartbeat")},1e3*e.heartbeatSpec.interval))}),d}function k(){this.log.trace("Retrieving pending commands"),this.retrieveCommands()}function l(){this.log.trace("Retrieving pending events"),this.retrieveEvents()}function m(a,b){return c.bind(function(a,c){this.emit(b,a),c.resolve()},a)}function n(a){this.log.debug("Received command %s(%s) progress",a.cmd.key,a.cmd.id,a.data);var b=this.layer.getResult(a.cmd.id);b?(this.log.trace("command %s(%s) has been found and progress will be updated",a.cmd.key,a.cmd.id),b.defer.notify(a.data)):this.log.warn("command %s(%s) wasn't found in waitingCommands",a.cmd.key,a.cmd.id)}return a.inherits(h,d),h.prototype.start=function(){var a=this,d=b.defer();return b.nextTick(function(){a.emit("before-start"),a.on("send-heartbeat",c.bind(j,a)),a.heartbeatSpec.manual||a.emit("send-heartbeat"),a.pendingCommandHandle&&clearInterval(a.pendingCommandHandle),a.pendingCommandHandle=setInterval(c.bind(k,a),1e3*a.pollingSpec.interval),a.pendingEventsHandle&&clearInterval(a.pendingEventsHandle),a.pendingEventsHandle=setInterval(c.bind(l,a),1e3*a.pollingSpec.interval),a.on("command",c.bind(i,a)),a.websocket&&a.layer.ws.init(a.websocket),d.resolve(a)}),d.promise},h.prototype.stop=function(){this.log.debug("Stopping agent %s",this.id),this.suspend()},h.prototype.suspend=function(a){var b=this;this.suspended=!0,this.pendingCommandHandle&&(this.log.trace("Stopping pending command handler"),clearInterval(this.pendingCommandHandle)),this.pendingEventsHandle&&(this.log.trace("Stopping pending event handler"),clearInterval(this.pendingEventsHandle)),this.nextHeartbeat&&(this.log.trace("Preventing next heartbeat from firing"),clearTimeout(this.nextHeartbeat)),this.resumeTimer&&(this.log.trace("Cancel the resume timer"),clearTimeout(this.resumeTimer)),a&&(this.resumeTimer=setTimeout(function(){b.resume()},1e3*a))},h.prototype.resume=function(){this.suspended=!1,this.pendingCommandHandle&&clearInterval(this.pendingCommandHandle),this.pendingCommandHandle=setInterval(c.bind(k,this),1e3*this.pollingSpec.interval),this.pendingEventsHandle&&clearInterval(this.pendingEventsHandle),this.pendingEventsHandle=setInterval(c.bind(l,this),1e3*this.pollingSpec.interval),delete this.resumeTimer,this.heartbeatSpec.manual||this.emit("send-heartbeat")},h.prototype.connect=function(a){return this.start(a)},h.prototype.subscribeTo=function(a,b,d){var e,f=this;d=d||{};var g=c.query.build(this.eventHandlers).and({key:a}).first();return!g||d.force?(e=f.layer.send(this,"subscribe",{event:a,options:d},c.pick(d,"timeout")),e.then(function(){d.force||(f.log.debug("Registering a new event handler for event %s",a),f.eventHandlers.push({key:a,handler:b,scope:f}))},function(b){f.log.error(b,"Unable to subscribe to event %s",a)})):f.log.warn("Already subscribed to event %s. Existing subscription will be reused",a),e},h.prototype.unsubscribeFrom=function(a){var b,d=this,e=c.query(this.eventHandlers,{key:a});return e?(b=d.layer.send(this,"unsubscribe",{channelId:e.channelId,event:a}),b.then(function(){d.log.debug("Removing event handler for event %s in channel %s",a,e.channelId),d.eventHandlers.remove(e)},function(b){d.log.error(b,"Unable to subscribe to event %s",a)})):d.log.warn("No subscription found for event %s. Unable to unsubscribe",a),b},h.prototype.broadcast=function(a,b,d){return this.layer.send(this,"broadcast",{event:a,payload:b||{},options:d},c.pick(d||{},"timeout"))},h.prototype.monitor=function(a,b){return this.layer.send(this,"start-monitoring",{key:a,interval:b.interval||5})},h.prototype.cancelMonitoring=function(a){return this.layer.send(this,"stop-monitoring",{key:a})},h.prototype.execute=function(a,b,d){return this.layer.send(this,"execute-command",{commandKey:a,payload:b,options:d||{}},c.pick(d||{},"timeout"))},h.prototype.executeOn=function(a,b,d,e){return this.layer.send(this,"execute-command-on",{agentId:a,commandKey:b,payload:d||{},options:e||{}},c.pick(e||{},"timeout"))},h.prototype.emitTo=function(a,b,d,e){return this.layer.send(this,"emit-to",{agents:a,event:b,payload:d,options:e},c.pick(e,"timeout"))},h.prototype.registerCommandHandler=function(a,b){this.log.debug("Register a new command handler %s",a),this.commandHandlers=this.commandHandlers||{},this.commandHandlers[a]=b},h.prototype.retrieveCommands=function(){var a,b=this;return a=b.layer.send(this,"retrieve-pending-commands"),a.then(function(a){c.isArray(a.data)?(b.log.debug("Received %d commands to execute",a.data.length),c.each(a.data,function(a){b.log.trace("Executing command %s",a.key),b.emit("command",a)})):b.emit("transport-error",{action:"retrieve-pending-commands",error:"Invalid command list"})},function(a){b.log.error("Unable to retrieve pending commands",a),b.emit("transport-error",{action:"retrieve-pending-commands",error:a})}).catch(function(a){b.log.error("Exception encountered while retrieving pending commands",a),b.emit("transport-error",{action:"retrieve-pending-commands",error:a})}),a},h.prototype.retrieveEvents=function(){var a,b=this;return a=b.layer.send(this,"retrieve-pending-events"),a.then(function(a){b.log.trace("Retrieve pending events successfully completed",a),c.isArray(a.data)?(b.log.debug("Received %d events to handle",a.data.length),c.each(a.data,function(a){b.log.trace("Received event",a);var d=c.query(b.eventHandlers,{key:a.key});c.each(d,function(c){c.handler.call(c.scope||b,a.data)})})):b.emit("transport-error",{action:"retrieve-pending-events",error:"Invalid event list"})},function(a){b.log.error("Unable to retrieve pending events",a),b.emit("transport-error",{action:"retrieve-pending-events",error:a})}).catch(function(a){b.log.error("Exception encountered while retrieving pending events",a),b.emit("transport-error",{action:"retrieve-pending-events",error:a})}),a},h}();module.exports=h}();