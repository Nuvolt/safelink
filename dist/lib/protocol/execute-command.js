/*! 
 safelink - v0.10.3 - 2014-05-09
(C) 2014 Joel Grenon. Distributed under the Apache Version 2.0, January 2004. See attached license
*/var Q=require("q"),redis=require("redis"),_=require("lodash"),shortid=require("shortid"),moment=require("moment");module.exports=function(a){var b=this;this.log.trace(a,"Handling execute-command command");var c=b.timeout;a.options&&(c=a.options.timeout||b.timeout);var d=Q.defer().timeout(1e3*c);return Q.nextTick(function(){var e=a.uuid||shortid.generate(),f=_.extend(a,{$id:e});f.timeout=c;var g=b.commandHandlers[a.commandKey];g?g.call(b,f).then(function(a){d.resolve(a)},function(a){d.reject(a)}):(b.once("command-result-"+e,function(a){d.resolve(a)}),b.emit("execute-"+f.commandKey,f),b.emit("execute-command",f))}),d.promise};