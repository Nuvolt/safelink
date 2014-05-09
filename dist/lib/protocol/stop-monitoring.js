/*! 
 safelink - v0.10.3 - 2014-05-09
(C) 2014 Joel Grenon. Distributed under the Apache Version 2.0, January 2004. See attached license
*/var Q=require("q"),redis=require("redis"),_=require("lodash"),async=require("async"),moment=require("moment");require("underscore-query"),module.exports=function(a){var b=this;this.log.trace(a,"Handling stop-monitoring command");var c=Q.defer();return Q.nextTick(function(){b.uninstallMonitor(a.payload.agent,a.payload.key),c.resolve({success:!0})}),c.promise};