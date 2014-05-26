- Send command directly through web socket instead of waiting for polling. We keep the polling loop anyway for robustness, but all commands should already be retrieved through 
web socket. 
- Add MQTT protocol on Web Socket
- Add QoS for event and commands
    0= Anything goes
    1= At least One
    2= Exactly One
