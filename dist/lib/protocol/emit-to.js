/*! 
 safelink - v0.10.3 - 2014-05-09
(C) 2014 Joel Grenon. Distributed under the Apache Version 2.0, January 2004. See attached license
*/var Q=require("q"),redis=require("redis"),_=require("lodash"),moment=require("moment");module.exports=function(a){return this.log.trace(a,"Handling emitTo command"),Q.invoke(this,"emitTo",a.agents,a.event,a.payload,a.options)};