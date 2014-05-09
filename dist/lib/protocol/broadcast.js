/*! 
 safelink - v0.10.3 - 2014-05-09
(C) 2014 Joel Grenon. Distributed under the Apache Version 2.0, January 2004. See attached license
*/var Q=require("q"),redis=require("redis"),_=require("lodash"),moment=require("moment");module.exports=function(a){var b=this;this.log.trace(a,"Handling broadcast command");var c=Q.defer();return Q.nextTick(function(){b.emit(a.event,_.extend(a.payload,{_replyTo:a.id})),c.resolve({success:!0})}),c.promise};