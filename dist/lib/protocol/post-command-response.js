/*! 
 safelink - v0.10.3 - 2014-05-09
(C) 2014 Joel Grenon. Distributed under the Apache Version 2.0, January 2004. See attached license
*/var Q=require("q"),redis=require("redis"),_=require("lodash"),async=require("async"),moment=require("moment");module.exports=function(a){var b=this;this.log.debug(a,"Handling post-command-response command");var c=Q.defer();return Q.nextTick(function(){b.applyCommandResponse(a.commandId,a.result).then(function(a){c.resolve(a)},function(a){c.reject(a)})}),c.promise};