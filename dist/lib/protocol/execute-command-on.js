/*! 
 safelink - v0.10.3 - 2014-05-09
(C) 2014 Joel Grenon. Distributed under the Apache Version 2.0, January 2004. See attached license
*/module.exports=function(a){var b=this;return this.log.trace(a,"Handling execute-command-on command"),a.uuid&&(a.options=a.options||{},a.options.uuid=a.uuid),this.executeOnAgent(a.agentId,a.commandKey,a.payload,a.options).progress(function(c){b.log.debug("Emitting command %s(%s) progress",c.cmd.key,c.cmd.id,c.data),b.emitTo(a.id,"command-progress",c)})};