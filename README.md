# web-react-sdk 使用文档 #

#### 安装uniapp依赖 ####
```html
npm install buffer --save
npm install msgpack-lite --save
```

#### 引入依赖库 ####
```html
const { RTVTClient }  = require('./rtvt-react-sdk/rtvt.sdk.js');
```

#### 使用示例 ####

```javascript

let rtvtClient = new RTVTClient({
    endpoint: 'wss://rtvt.ilivedata.com:14002',  // endpoint由控制台获取
    pid: pid,   // pid由控制台获取
    uid: uid,  // uid
});

// 发生自动重连时触发
rtvtClient.on("ReloginCompleted", function(ok, errorCode) {
    console.log("ReloginCompleted, ok: " + ok + " errorCode: " + errorCode);
});

// 内部错误采集
rtvtClient.on("ErrorRecorder", function(error) {
    console.log(error);
});

/* 
登录
token: 生成方式见下文
ts: 与生成token时使用的ts一致
*/
rtvtClient.login(token, ts, function(ok, errorCode) {
    if (!ok) {
        console.log("login fail: " + errorCode);
        return;
    }

    /*
        创建流, createStream(srcLang, destLang, asrResult, tempResult, transResult, callback)
            srcLang: 源语言
            destLang: 翻译目标语言
            asrResult: 是否需要识别最终结果
            tempResult: 是否需要识别临时结果
            transResult: 是否需要翻译最终结果
            callback: 结果回调
    */
    rtvtClient.createStream("zh", "en", true, true, true, function(stream, errorCode) {
        if (stream == null) {
            console.log("create stream fail: " + errorCode);
            return;
        }

        // 有识别结果时触发，data具体格式见下文
        rtvtClient.on("recognizedResult", function(data) {
            console.log(data);
        });

        // 有翻译结果时触发，data具体格式见下文
        rtvtClient.on("translatedResult", function(data) {
            console.log(data);
        });

        // 有临时识别结果时触发，data具体格式见下文
        rtvtClient.on("recognizedTempResult", function(data) {
            console.log(data);
        });

        // 有临时翻译结果时触发，data具体格式见下文
        rtvtClient.on("translatedTempResult", function(data) {
            console.log(data);
        });

        // 发送音频PCM数据, 要求16000采样率 单声道 固定640字节，seq为语音片段序号(尽量有序)
        rtvtClient.sendVoice(stream, seq, pcm);
    });
});
```

#### token生成方式 ####

```javascript
var CryptoJS = require("crypto-js");

function encryptWithHmacSHA256(coreString, base64Key) {
    var keyWordArray = CryptoJS.enc.Base64.parse(base64Key);
    var hash = CryptoJS.HmacSHA256(coreString, keyWordArray);
    var base64Hash = CryptoJS.enc.Base64.stringify(hash);
    return base64Hash;
}

var pid = 81700001;
var key = 'xxxxx-xxxx-xxxx-xxxx-xxxxx';
var ts = parseInt(new Date().getTime() / 1000);
var coreString = pid + ":" + ts;
var token = encryptWithHmacSHA256(coreString, key);
```

#### 识别与翻译结果推送结构示例 ####

```javascript
// 识别
{
    "pid": 81700001,
    "streamId": 1303369879658692600,
    "startTs": 1669603280951,
    "endTs": 1669603286480,
    "recTs": 1669603286864,
    "asr": "喂喂"
}

// 翻译
{
    "pid": 81700001,
    "streamId": 1303369879658692600,
    "startTs": 1669603280951,
    "endTs": 1669603286480,
    "trans": "Hey, hey",
    "recTs": 1669603286864,
    "lang": "en"
}
```

