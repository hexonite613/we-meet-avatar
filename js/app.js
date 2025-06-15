// Global objects
let avatarSynthesizer;
let peerConnection;
let previousAnimationFrameTimestamp = 0;
let speechRecognizer;
let isRecording = false;

// Logger
const log = msg => {
    const loggingElement = document.getElementById('logging');
    if (loggingElement) {
        loggingElement.innerHTML += msg + '<br>';
    } else {
        console.error('Logging element not found');
    }
}

// 채팅 메시지 추가 함수
function addMessage(message, isUser = false) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) {
        console.error('채팅 메시지 컨테이너를 찾을 수 없습니다');
        return;
    }
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'avatar-message'}`;
    messageDiv.textContent = message;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// "답변 작성 중..." 인디케이터 제거 함수
function removeTypingIndicator() {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

// GPT API 호출 함수
async function callGPTAPI(message) {
    try {
        const response = await fetch('/api/gpt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: message })
        });

        if (!response.ok) {
            throw new Error('GPT API 호출 실패');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.content;
                        if (content) {
                            fullResponse += content;
                            // 문장 부호(.?!) 뒤에 공백이 올 때만 줄바꿈을 추가합니다.
                            const formattedResponse = fullResponse.replace(/([.?!])\s/g, '$1\n');
                            updateChatUI(formattedResponse, false, true);
                        }
                    } catch (e) {
                        console.error('응답 파싱 오류:', e);
                    }
                }
            }
        }

        if (!fullResponse) {
            // 스트리밍에서 아무 내용도 받지 못한 경우 인디케이터 제거
            removeTypingIndicator();
        }

        // GPT 응답이 완료되면 아바타가 말하도록 설정
        if (avatarSynthesizer && fullResponse) {
            const spokenSsml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${document.getElementById('ttsVoice').value}'><mstts:ttsembedding speakerProfileId='{}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(fullResponse)}</mstts:ttsembedding></voice></speak>`;
            avatarSynthesizer.speakSsmlAsync(spokenSsml).then(
                () => {
                    log("[" + (new Date()).toISOString() + "] Speak request completed.");
                    document.getElementById('stopSpeaking').disabled = false;
                }
            ).catch(log);
        }

        return fullResponse;
    } catch (error) {
        console.error('GPT API 호출 오류:', error);
        throw error;
    }
}

// 채팅 UI 업데이트 함수
function updateChatUI(message, isUser = false, isUpdate = false) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) {
        console.error('채팅 메시지 컨테이너를 찾을 수 없습니다');
        return;
    }
    
    const typingIndicator = document.getElementById('typing-indicator');

    if (typingIndicator) {
        // 인디케이터가 있으면 내용 업데이트하고 ID 제거
        typingIndicator.textContent = message;
        typingIndicator.removeAttribute('id');
    } else if (isUpdate) {
        // 스트리밍 중인 마지막 메시지 업데이트
        const lastMessage = chatMessages.lastElementChild;
        if (lastMessage && !lastMessage.classList.contains('user-message')) {
            lastMessage.textContent = message;
        } else {
            // 이 경우는 발생하면 안되지만, 안전장치로 새 메시지 추가
            addMessage(message, false);
        }
    } else {
        // 새 메시지 추가
        addMessage(message, isUser);
    }
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// "답변 작성 중..." 인디케이터 추가 함수
function addTypingIndicator() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) {
        console.error('채팅 메시지 컨테이너를 찾을 수 없습니다');
        return;
    }
    
    // 기존 인디케이터가 있다면 제거
    const existingIndicator = document.getElementById('typing-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    const indicatorDiv = document.createElement('div');
    indicatorDiv.className = 'message avatar-message';
    indicatorDiv.id = 'typing-indicator';
    
    const thinkingSpan = document.createElement('span');
    thinkingSpan.className = 'thinking-dot';
    thinkingSpan.textContent = '●';
    
    const thinkingSpan2 = document.createElement('span');
    thinkingSpan2.className = 'thinking-dot';
    thinkingSpan2.textContent = '●';
    
    const thinkingSpan3 = document.createElement('span');
    thinkingSpan3.className = 'thinking-dot';
    thinkingSpan3.textContent = '●';
    
    indicatorDiv.appendChild(thinkingSpan);
    indicatorDiv.appendChild(thinkingSpan2);
    indicatorDiv.appendChild(thinkingSpan3);
    
    chatMessages.appendChild(indicatorDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 채팅 전송 함수
async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) {
        console.error('메시지 입력 요소를 찾을 수 없습니다');
        return;
    }
    const message = messageInput.value.trim();
    
    if (message) {
        // 입력창 즉시 초기화
        messageInput.value = '';
        messageInput.style.height = '70px'; // 높이 초기화 (CSS와 동일하게)

        // 사용자 메시지 추가
        addMessage(message, true);
        
        // "답변 작성 중..." 인디케이터 추가
        addTypingIndicator();
        
        try {
            // GPT API 호출 및 응답 처리
            await callGPTAPI(message);
        } catch (error) {
            console.error('채팅 처리 오류:', error);
            // 오류 발생 시 인디케이터를 제거하고 오류 메시지를 표시합니다.
            removeTypingIndicator();
            addMessage('죄송합니다. 오류가 발생했습니다.', false);
        }
    }
}

// 이벤트 리스너 설정
document.addEventListener('DOMContentLoaded', () => {
    const sendButton = document.getElementById('sendButton');
    const messageInput = document.getElementById('messageInput');
    const recordButton = document.getElementById('recordButton');

    if (sendButton && messageInput && recordButton) {
        sendButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = (messageInput.scrollHeight) + 'px';
        });
        recordButton.addEventListener('click', toggleRecord);
    } else {
        console.error('채팅/음성 인식 요소를 찾을 수 없습니다');
    }

    // 초기 메시지 추가
    addMessage("AZ-900과 관련하여 무엇이든 질문해주세요!", false);
});

// 페이지 로드 시 자동으로 아바타 시작
window.addEventListener('load', async () => {
    try {
        console.log('페이지 로드 시작');
        
        // .env 파일에서 설정 가져오기
        console.log('설정 요청 시작');
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const config = await response.json();
        console.log('받은 설정:', config);

        // 설정 적용
        const elements = {
            region: document.getElementById('region'),
            subscriptionKey: document.getElementById('subscriptionKey'),
            ttsVoice: document.getElementById('ttsVoice')
        };

        // 각 요소 존재 여부 확인
        for (const [key, element] of Object.entries(elements)) {
            if (!element) {
                throw new Error(`${key} 요소를 찾을 수 없습니다`);
            }
        }

        // 설정 값 적용
        elements.region.value = config.SPEECH_REGION || 'eastus2';
        elements.subscriptionKey.value = config.SPEECH_KEY || '';
        elements.ttsVoice.value = config.voice || 'ko-KR-YuJinNeural';

        console.log('설정 적용 완료:', {
            region: elements.region.value,
            key: elements.subscriptionKey.value ? '***' : 'missing',
            voice: elements.ttsVoice.value
        });

        // SpeechRecognizer 초기화
        const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(config.SPEECH_KEY, config.SPEECH_REGION);
        speechConfig.speechRecognitionLanguage = "ko-KR"; // 한국어 설정
        const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
        speechRecognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

        // 음성 인식 이벤트 핸들러
        speechRecognizer.recognizing = (s, e) => {
            if (e.result.reason === SpeechSDK.ResultReason.RecognizingSpeech) {
                document.getElementById('messageInput').value = e.result.text;
            }
        };

        speechRecognizer.recognized = (s, e) => {
            if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
                const recognizedText = e.result.text;
                document.getElementById('messageInput').value = recognizedText;
                // 인식된 텍스트로 메시지 전송 (자동 전송 활성화)
                if (recognizedText) {
                    sendMessage(); 
                }
            } else if (e.result.reason === SpeechSDK.ResultReason.NoMatch) {
                console.log("NOMATCH: 음성을 인식할 수 없습니다.");
            }
        };

        speechRecognizer.canceled = (s, e) => {
            console.log(`CANCELED: Reason=${e.reason}`);
            if (e.reason === SpeechSDK.CancellationReason.Error) {
                console.log(`CANCELED: ErrorCode=${e.errorCode}`);
                console.log(`CANCELED: ErrorDetails=${e.errorDetails}`);
                console.log("CANCELED: 음성 인식 오류. 마이크를 확인하거나 브라우저 권한을 확인하세요.");
            }
            speechRecognizer.stopContinuousRecognitionAsync();
            isRecording = false;
            updateRecordButton();
        };

        speechRecognizer.sessionStopped = (s, e) => {
            console.log("\n    Session stopped event.");
            speechRecognizer.stopContinuousRecognitionAsync();
            isRecording = false;
            updateRecordButton();
        };

    } catch (error) {
        console.error('초기화 오류:', error);
        console.error('에러 스택:', error.stack);
        log(`초기화 오류: ${error.message}`);
        log(`상세 정보: ${error.stack}`);
    }
});

// Record 버튼 상태 업데이트
function updateRecordButton() {
    const recordButton = document.getElementById('recordButton');
    if (recordButton) {
        if (isRecording) {
            recordButton.classList.add('recording');
            recordButton.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.2-3c0 2.48-2.02 4.5-4.5 4.5S7.5 13.48 7.5 11H6c0 3.53 2.61 6.43 6 6.92V21h3v-3.08c3.39-.49 6-3.41 6-6.92h-1.5z"/></svg>`; // 녹음 중 아이콘 (빨간색 등) 변경
        } else {
            recordButton.classList.remove('recording');
            recordButton.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.2-3c0 2.48-2.02 4.5-4.5 4.5S7.5 13.48 7.5 11H6c0 3.53 2.61 6.43 6 6.92V21h3v-3.08c3.39-.49 6-3.41 6-6.92h-1.5z"/></svg>`; // 기본 마이크 아이콘
        }
    }
}

// 음성 녹음 시작/중지 토글 함수
async function toggleRecord() {
    if (!speechRecognizer) {
        console.error('SpeechRecognizer가 초기화되지 않았습니다.');
        return;
    }

    if (isRecording) {
        // 녹음 중지
        await speechRecognizer.stopContinuousRecognitionAsync();
        isRecording = false;
        console.log('음성 인식 중지됨.');
    } else {
        // 녹음 시작
        document.getElementById('messageInput').value = ''; // 입력창 초기화
        await speechRecognizer.startContinuousRecognitionAsync();
        isRecording = true;
        console.log('음성 인식 시작됨. 말하세요...');
    }
    updateRecordButton();
}

// Setup WebRTC
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    // Create WebRTC peer connection
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: iceServerUrl,
            username: iceServerUsername,
            credential: iceServerCredential
        }]
    });

    // Fetch WebRTC video stream and mount it to an HTML video element
    peerConnection.ontrack = function (event) {
        // Clean up existing video element if there is any
        const videoContainer = document.getElementById('videoContainer');
        for (var i = 0; i < videoContainer.childNodes.length; i++) {
            if (videoContainer.childNodes[i].localName === event.track.kind) {
                videoContainer.removeChild(videoContainer.childNodes[i]);
            }
        }

        const mediaPlayer = document.createElement(event.track.kind);
        mediaPlayer.id = event.track.kind;
        mediaPlayer.srcObject = event.streams[0];
        mediaPlayer.autoplay = true;
        mediaPlayer.style.width = '100%';
        mediaPlayer.style.height = '100%';
        mediaPlayer.style.objectFit = 'cover';
        document.getElementById('videoContainer').appendChild(mediaPlayer);
        document.getElementById('overlayArea').hidden = false;

        if (event.track.kind === 'video') {
            mediaPlayer.playsInline = true;
            const videoContainer = document.getElementById('videoContainer');
            const canvas = document.getElementById('canvas');
            
            // 투명 배경 관련 및 너비 조작 코드 완전히 제거 또는 주석 처리
            // if (document.getElementById('transparentBackground').checked) {
            //     canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            //     canvas.hidden = false;
            // } else {
            //     canvas.hidden = true;
            // }
            // mediaPlayer.addEventListener('play', () => {
            //     if (document.getElementById('transparentBackground').checked) {
            //         window.requestAnimationFrame(makeBackgroundTransparent);
            //     }
            // });

        } else if (event.track.kind === 'audio') {
            mediaPlayer.muted = false;
            mediaPlayer.volume = 1.0;
            mediaPlayer.play().catch(error => {
                console.error('오디오 재생 오류:', error);
            });
        }
    };

    // Make necessary update to the web page when the connection state changes
    peerConnection.oniceconnectionstatechange = e => {
        log("WebRTC status: " + peerConnection.iceConnectionState);

        if (peerConnection.iceConnectionState === 'connected') {
            document.getElementById('stopSession').disabled = false;
            document.getElementById('speak').disabled = false;
            document.getElementById('configuration').hidden = true;
        }

        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            document.getElementById('speak').disabled = true;
            document.getElementById('stopSpeaking').disabled = true;
            document.getElementById('stopSession').disabled = true;
            document.getElementById('startSession').disabled = false;
            document.getElementById('configuration').hidden = false;
        }
    };

    // Offer to receive 1 audio, and 1 video track
    peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

    // start avatar, establish WebRTC connection
    avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log("[" + (new Date()).toISOString() + "] Avatar started. Result ID: " + r.resultId);
        } else {
            console.log("[" + (new Date()).toISOString() + "] Unable to start avatar. Result ID: " + r.resultId);
            if (r.reason === SpeechSDK.ResultReason.Canceled) {
                let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r);
                if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                    console.log(cancellationDetails.errorDetails);
                }
                log("Unable to start avatar: " + cancellationDetails.errorDetails);
            }
            document.getElementById('startSession').disabled = false;
            document.getElementById('configuration').hidden = false;
        }
    }).catch(
        (error) => {
            console.log("[" + (new Date()).toISOString() + "] Avatar failed to start. Error: " + error);
            document.getElementById('startSession').disabled = false;
        }
    );
}

// Make video background transparent by matting
function makeBackgroundTransparent(timestamp) {
    // Throttle the frame rate to 30 FPS to reduce CPU usage
    if (timestamp - previousAnimationFrameTimestamp > 30) {
        video = document.getElementById('video');
        tmpCanvas = document.getElementById('tmpCanvas');
        tmpCanvasContext = tmpCanvas.getContext('2d', { willReadFrequently: true });
        tmpCanvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        if (video.videoWidth > 0) {
            let frame = tmpCanvasContext.getImageData(0, 0, video.videoWidth, video.videoHeight);
            for (let i = 0; i < frame.data.length / 4; i++) {
                let r = frame.data[i * 4 + 0];
                let g = frame.data[i * 4 + 1];
                let b = frame.data[i * 4 + 2];
                if (g - 150 > r + b) {
                    // Set alpha to 0 for pixels that are close to green
                    frame.data[i * 4 + 3] = 0;
                } else if (g + g > r + b) {
                    // Reduce green part of the green pixels to avoid green edge issue
                    adjustment = (g - (r + b) / 2) / 3;
                    r += adjustment;
                    g -= adjustment * 2;
                    b += adjustment;
                    frame.data[i * 4 + 0] = r;
                    frame.data[i * 4 + 1] = g;
                    frame.data[i * 4 + 2] = b;
                    // Reduce alpha part for green pixels to make the edge smoother
                    a = Math.max(0, 255 - adjustment * 4);
                    frame.data[i * 4 + 3] = a;
                }
            }

            canvas = document.getElementById('canvas');
            canvasContext = canvas.getContext('2d');
            canvasContext.putImageData(frame, 0, 0);
        }

        previousAnimationFrameTimestamp = timestamp;
    }

    window.requestAnimationFrame(makeBackgroundTransparent);
}

// Do HTML encoding on given text
function htmlEncode(text) {
    const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;'
    };

    return String(text).replace(/[&<>"'\/]/g, (match) => entityMap[match]);
}

// Azure Speech 서비스 설정
async function initializeSpeechService() {
    try {
        console.log('Speech 서비스 초기화 시작...');
        const response = await fetch('/api/speech-config');
        const config = await response.json();
        console.log('Speech 설정 받음:', config);
        
        if (!config.speechKey || !config.speechRegion) {
            throw new Error('Speech 서비스 설정이 누락되었습니다.');
        }

        // Speech 설정
        speechConfig = SpeechSDK.SpeechConfig.fromSubscription(config.speechKey, config.speechRegion);
        speechConfig.speechRecognitionLanguage = 'ko-KR';
        speechConfig.speechSynthesisLanguage = 'ko-KR';
        speechConfig.speechSynthesisVoiceName = 'ko-KR-YuJinNeural';

        // 아바타 설정은 startSession에서 수행

        console.log('Speech SDK 초기화 완료');
        return true;
    } catch (error) {
        console.error('Speech 서비스 초기화 실패:', error);
        return false;
    }
}

// Window event handlers
window.startSession = () => {
    const cogSvcRegion = document.getElementById('region').value;
    const cogSvcSubKey = document.getElementById('subscriptionKey').value;
    if (cogSvcSubKey === '') {
        alert('Please fill in the subscription key of your speech resource.');
        return;
    }

    let speechSynthesisConfig;

    speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);

    const videoFormat = new SpeechSDK.AvatarVideoFormat();
    // 좌우를 더 많이 잘라내어 아바타를 확실하게 확대합니다.
    let videoCropTopLeftX = 400;
    let videoCropBottomRightX = 1520;
    videoFormat.setCropRange(new SpeechSDK.Coordinate(videoCropTopLeftX, 0), new SpeechSDK.Coordinate(videoCropBottomRightX, 1080));

    
    const talkingAvatarCharacter = document.getElementById('talkingAvatarCharacter').value;
    const talkingAvatarStyle = document.getElementById('talkingAvatarStyle').value;
    const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle, videoFormat);
    avatarConfig.backgroundColor = document.getElementById('backgroundColor').value;
    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);
    avatarSynthesizer.avatarEventReceived = function (s, e) {
        var offsetMessage = ", offset from session start: " + e.offset / 10000 + "ms.";
        if (e.offset === 0) {
            offsetMessage = "";
        }
        console.log("[" + (new Date()).toISOString() + "] Event received: " + e.description + offsetMessage);
    }

    document.getElementById('startSession').disabled = true;

    const xhr = new XMLHttpRequest();

    xhr.open("GET", `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`);

    xhr.setRequestHeader("Ocp-Apim-Subscription-Key", cogSvcSubKey);
    xhr.addEventListener("readystatechange", function() {
        if (this.readyState === 4) {
            const responseData = JSON.parse(this.responseText);
            const iceServerUrl = responseData.Urls[0];
            const iceServerUsername = responseData.Username;
            const iceServerCredential = responseData.Password;
            setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential);
        }
    });
    xhr.send();
};

window.speak = () => {
    document.getElementById('speak').disabled = true;
    document.getElementById('stopSpeaking').disabled = false;
    
    // 오디오 요소 찾기 및 음소거 해제
    const audioElement = document.getElementById('audio');
    if (audioElement) {
        audioElement.muted = false;
        audioElement.volume = 1.0;
    }
    
    // 마지막 아바타 메시지를 찾습니다.
    const chatMessages = document.getElementById('chatMessages');
    const lastAvatarMessage = chatMessages.querySelector('.avatar-message:last-of-type');
    
    if (!lastAvatarMessage) {
        console.log("다시 말할 아바타 메시지가 없습니다.");
        document.getElementById('speak').disabled = false; // 다시 시도할 수 있도록 버튼 활성화
        document.getElementById('stopSpeaking').disabled = true;
        return;
    }

    let spokenText = lastAvatarMessage.textContent;
    let ttsVoice = document.getElementById('ttsVoice').value;
    let spokenSsml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:ttsembedding speakerProfileId='{}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(spokenText)}</mstts:ttsembedding></voice></speak>`;
    console.log("[" + (new Date()).toISOString() + "] Speak request sent.");
    avatarSynthesizer.speakSsmlAsync(spokenSsml).then(
        (result) => {
            document.getElementById('speak').disabled = false;
            document.getElementById('stopSpeaking').disabled = true;
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                console.log("[" + (new Date()).toISOString() + "] Speech synthesized to speaker for text [ " + spokenText + " ]. Result ID: " + result.resultId);
            } else {
                console.log("[" + (new Date()).toISOString() + "] Unable to speak text. Result ID: " + result.resultId);
                if (result.reason === SpeechSDK.ResultReason.Canceled) {
                    let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result);
                    console.log(cancellationDetails.reason);
                    if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                        console.log(cancellationDetails.errorDetails);
                    }
                }
            }
        }).catch(log);
};

window.stopSpeaking = () => {
    document.getElementById('stopSpeaking').disabled = true;
    avatarSynthesizer.stopSpeakingAsync().then(
        log("[" + (new Date()).toISOString() + "] Stop speaking request sent.")
    ).catch(log);
};

window.stopSession = () => {
    document.getElementById('speak').disabled = true;
    document.getElementById('stopSession').disabled = true;
    document.getElementById('stopSpeaking').disabled = true;
    if (avatarSynthesizer) {
        avatarSynthesizer.close();
    }

    // 아바타 비디오/오디오 요소를 제거합니다.
    const videoElement = document.getElementById('video');
    if (videoElement) {
        videoElement.remove();
    }
    const audioElement = document.getElementById('audio');
    if (audioElement) {
        audioElement.remove();
    }

    // UI를 초기 상태로 리셋합니다.
    document.getElementById('startSession').disabled = false;
    document.getElementById('configuration').hidden = false;
};