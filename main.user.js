// ==UserScript==
// @name         小說閱讀器插件
// @namespace    https://github.com/naimiliu/novelreader
// @version      1.1.1
// @description  自動抓取正文，提供字體調整、自動捲動等功能，提升小說閱讀體驗。
// @icon         https://raw.githubusercontent.com/naimiliu/novelreader/main/default.png
// @author       naimiliu
// @match        https://*/*
// @exclude      *://*.google.com.tw/*
// @exclude      *://*.facebook.*/*
// @grant        none
// @run-at       document-end
// @require      https://cdnjs.cloudflare.com/ajax/libs/readability/0.6.0/Readability.min.js
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.3.1/dist/umd/full.js
// ==/UserScript==
/* global Readability */
/* global OpenCC */

(function() {
    'use strict';

    // 1. 網址規則判斷，只在特定網址啟用閱讀模式
    const urlPattern = /^https?:\/\/[^\/]+\/(read\/\d+_\d+.html$|read\/\d+\/p\d+.html$|read\/\d+\/\??\d+(_\d+){0,1}$|\d+\/\d+(_\d+){0,2}.html$|\d+_\d+\/\d+.html$|chapter\/\d+\/\d+.html$|chapter\/\d+\/\d+\/$|book\/\d+\/\d+.html$|book_\d+\/\d+.html$|book\/\d+\/\d+.html$|Book\/Read\/\d+,\d+$|txt\/\d+\/\d+$|txt\/\d+\/\d+.html$|html\/\d+\/\d+\/\d+.html$|fxnread\/\d+_\d+.html$|n\/\w*\/\d+.html$)/;

    // 檢查目前網址，不符合則結束
    if (!urlPattern.test(window.location.href)) {
        return;
    }

    function initButton() {
        const readerMode = localStorage.getItem('reader_mode');
        if (readerMode === 'close') {
            localStorage.removeItem('reader_mode'); // 用完即丟

            const btn = document.createElement('button');
            btn.id = 'read-btn';
            btn.innerHTML = "ʘʘ";
            btn.title = "進入閱讀模式";
            btn.style = `
                position:fixed; bottom:25px; right:20px; z-index:2147483646;
                width:50px; height:50px; background:#0D0D0D; color: rgb(138, 180, 248);
                border-radius:50%; border:2px solid rgb(138, 180, 248);
                font-size:24px; cursor:pointer; box-shadow:0 4px 10px rgba(0,0,0,0.5);
                display:block !important;
            `;

            document.body.appendChild(btn);

            btn.onclick = () => {
                startReader();
                btn.style.display = 'none';
            };
        } else {
            startReader();
        }
    }

    class ConsistentLongTextSpeaker {
        constructor() {
            this.synth = window.speechSynthesis;
            this.targetVoice = null;
            this.config = {
                lang: 'zh-TW',
                rate: 1.0,
                pitch: 1.0,
                volume: 1.0
            };
            
            // 初始化語音庫（處理 getVoices 非同步載入問題）
            this._initVoices();
        }

        _initVoices() {
            const loadVoices = () => {
                const voices = this.synth.getVoices();
                // 優先尋找微軟台灣曉臻（常見且好聽），次之選取任何台灣中文，最後保底中文
                this.targetVoice = voices.find(v => (v.name.includes("曉臻") || v.name.includes("Hsiaochen")) && v.lang === "zh-TW")
                                || voices.find(v => v.name.includes("臺灣") && v.lang === "zh-TW")
                                || voices.find(v => v.lang === "zh-TW")
                                || voices.find(v => v.lang.includes("zh"));
                //console.log("可用語音列表：", voices);
                if (!this.targetVoice) {
                    console.log("未找到符合的語音");
                } else {
                    console.log("選定的語音：", this.targetVoice.name, this.targetVoice.lang);
                }
            };

            loadVoices();
            if (this.synth.onvoiceschanged !== undefined) {
                this.synth.onvoiceschanged = loadVoices;
            }
        }

        /**
         * 將長文字切編成短句陣列
         */
        _splitText(text) {
            // 使用正規表達式，依據常見標點符號切分，並過濾掉空白字串
            return text.split(/([。？！；…\n\r]|\,\s*)/g)
                    .map(s => s.trim())
                    .filter(s => s.length > 0)
                    .reduce((acc, current) => {
                        // 重新把標點符號接回前一句的尾巴，讓語氣更自然
                        const punctuations = ["。", "？", "！", "；", "…", ","];
                        if (punctuations.includes(current) && acc.length > 0) {
                            acc[acc.length - 1] += current;
                        } else {
                            acc.push(current);
                        }
                        return acc;
                    }, []);
        }

        /**
         * 開始播放長文字
         */
        speak(longText) {
            // 1. 先停止目前正在播放或排隊的語音，清除狀態
            this.synth.cancel();

            if (!longText) return;

            // 2. 切割文字
            const sentences = this._splitText(longText);
            console.log("切片後的句子：", sentences);

            // 3. 依序將切片丟入瀏覽器播放隊列
            sentences.forEach((sentence, index) => {
                const utterance = new SpeechSynthesisUtterance(sentence);
                
                // 核心：每一句都強制綁定相同的語音與參數
                if (this.targetVoice) {
                    utterance.voice = this.targetVoice;
                }
                utterance.lang = this.config.lang;
                utterance.rate = this.config.rate;
                utterance.pitch = this.config.pitch;
                utterance.volume = this.config.volume;

                // 可選：監聽事件（例如追蹤進度）
                if (index === 0) {
                    utterance.onstart = () => console.log("長文字開始播放...");
                }
                if (index === sentences.length - 1) {
                    utterance.onend = () => console.log("全部文字播放完畢！");
                }

                // 丟入全域播放佇列，瀏覽器會自動順序播放
                this.synth.speak(utterance);
            });
        }

        /**
         * 隨時停止播放
         */
        stop() {
            this.synth.cancel();
        }
    }    

    function startReader() {
        try {
            customConverter();
            const docClone = document.cloneNode(true);
            const article = cleanDoc(docClone);
            if (article) {
                renderReader(article);
                localStorage.removeItem('reader_retry_cnt'); // 成功後重置重試次數
            } else {
                const retryCnt = parseInt(localStorage.getItem('reader_retry_cnt') || '0');
                localStorage.setItem('reader_retry_cnt', retryCnt + 1);
                if (retryCnt < 3) {
                    setTimeout(() => {
                        initButton(); // 重新初始化按鈕，讓用戶可以再次嘗試
                    }, retryCnt * 1000);
                }
                else {
                    localStorage.removeItem('reader_retry_cnt'); // 用完即丟
                    localStorage.setItem('reader_mode', 'close');
                    alert("抱歉，已嘗試多次，無法解析此頁面的正文內容。");
                    initButton();
                }
            }
        } catch (e) {
            console.error("解析出錯:", e);
            alert("解析出錯，請檢查控制台。");
        }
    }

    function renderReader(article) {
        const nextLink = findNextLink(document);
        const prevLink = findPrevLink(document);

        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        if (isMobile) {
            let viewport = document.querySelector('meta[name="viewport"]');
            if (!viewport) {
                viewport = document.createElement('meta');
                viewport.name = "viewport";
                document.head.appendChild(viewport);
            }
            viewport.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
        }

        const host = document.createElement('div');
        host.id = "my-reader-overlay";
        Object.assign(host.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            backgroundColor: '#0D0E0E',
            color: '#90908E',
            zIndex: '2147483647',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch'
        });
        const shadow = host.attachShadow({
            mode: 'open'
        });
        document.body.appendChild(host);
        document.body.style.overflow = 'hidden';

        let currentSize = parseInt(localStorage.getItem('reader_font_size')) || 28;
        let currentColor = localStorage.getItem('reader_text_color') || '#a0a0a0';
        let currentBgColor = localStorage.getItem('reader_bg_color') || '#111111';
        const style = document.createElement('style');
        style.textContent = `
            :host {
                --main-font-size: ${currentSize}px;
                --main-text-color: ${currentColor};
                --main-bg-color: ${currentBgColor};
                all: initial;
                font-family: "Microsoft Yahei", Arial, sans-serif;
                display:flex; position:fixed; top:0; left:0; width:100%; height:100%;
                color: var(--main-text-color); background-color: var(--main-bg-color) !important;
                justify-content: center; overflow-y:auto;
                z-index:999999; 
                -webkit-overflow-scrolling: touch;
            }
            .nr_layout { width: 95% !important; margin: 60px auto 20px; padding: 20px 0; max-width: 800px; }
            @media (min-width: 1000px) { .nr_layout { width: 80% !important; max-width: 1250px; } }
            .nr_content { font-size: var(--main-font-size) !important; color: var(--main-text-color) !important; 
                line-height: 1.3 !important; letter-spacing: 1px !important; word-wrap: break-word !important; 
                overflow-wrap: break-word !important; padding-bottom: 80vh !important; 
            }
            h1 { font-size: 25px; color: var(--main-text-color) !important; text-align: center; margin-bottom: 40px; }
            .nr_content p { text-indent:2em !important; margin-bottom: 1.2em !important; text-align: justify;}
            button { border-radius:8px; background:#444; color:#fff; border:none; cursor: pointer;}
            button:focus { outline:none; }
            .controls { position: fixed; top: 5px; width: auto; height: auto; display: flex; justify-content: flex-end; align-items: center; gap: 5px; padding: 5px; background: #a0a0a0; border-radius: 8px; z-index: 2147483647; transition: opacity 0.3s; opacity: '0'; pointer-events: auto; box-sizing: border-box; }
            .controls:hover { opacity: 1; }
            .controls span {display:inline-flex; align-items: center;vertical-align: middle;gap: 5px;}
            .controls span button { width:32px; height:32px; border: none; background:none; display: flex; align-items: center; justify-content: center;cursor: pointer; padding: 0;}
            .controls span label { width: 45px; font-size:16px; color: #444; line-height: 1; text-align: center; }
            .tips { display: none; position: fixed; bottom: 5px; width: auto; height:30px; padding: 5px 20px; font-size: 20px; color: white; background: #444; border-radius: 5px; }
            .page-scroll-container { position: fixed; top: 50%; right: 40px; display: flex; flex-direction: column; gap: 2px; z-index: 2147483647; }
            .page-scroll-container button { width: 48px; height: 48px; padding: 0; background: none;z-index: 2147483647; opacity: 0.3; }
            .page-scroll-container button:hover { opacity: 0.6; }
            .page-scroll-container button:disabled { opacity: 0.1; cursor: not-allowed; }
            .color-options { position: fixed; top: 60px; justify-content: flex-end; align-items: center; gap: 15px; padding: 8px 10px; z-index: 2147483647; background: #a1a5aa; border-radius: 8px; box-sizing: border-box; }
            .color-cb { border: 1px solid #898989; display: inline-block; width: 45px; height: 35px; overflow: hidden; vertical-align: middle;  box-sizing: border-box; cursor: pointer; }
            .color-cb:hover { border-color: rgb(138, 180, 248); border-width: 3px; }
            #text-selection-options { display: none; position: fixed; min-width: 232px; color: black;background: white; padding: 10px; border: 1px solid #ccc; border-radius: 20px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); z-index: 2147483647; }
            #text-selection-options button { font-size: 14px; color: #007BFF; background: none; border: none; cursor: pointer; }
            #text-selection-options button:hover { color: #0056b3; }
            #pinyin-popup { font-family: "Microsoft JhengHei", sans-serif; min-width: 250px; max-width: 400px; display: none; position: fixed; background: #fff; border: 2px solid #0056b3; border-radius: 8px; padding: 0px; z-index: 2147483647; }   
            #pinyin-popup button { position: fixed; top: 0px; right: 0px; height: 30px; width: 30px; font-size: 14px; color: #fff; background: none; border: none; border-radius: 0 8px 0 0; cursor: pointer; }
            #pinyin-popup button:hover { background: red; }
            #pinyin-popup-header { cursor: move; background: #007BFF; color: white; height: 30px; padding-left: 10px;  border-top-left-radius: 8px; border-top-right-radius: 8px; display: flex; align-items: center; justify-content: space-between; }
            #pinyin-popup-content { max-height: 300px; font-size: 16px;color: black; background: #fff;padding: 20px 12px;line-height: 2.5; border: 1px solid #ccc; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; overflow-y: scroll; overflow-x: hidden; }
            .py-result-item { padding-right: 5px; }
       `;
        shadow.appendChild(style);

        // 正文容器
        const container = document.createElement('div');
        container.className = 'nr_layout';
        container.id = 'nr_layout';
        container.innerHTML = `<h1 id="nr_title">${article.title}</h1><div id="nr_content" class="nr_content">${article.content}</div>`;
        shadow.appendChild(container);

        // 提示訊息元素
        const tips = document.createElement('div');
        let tipsTimerId = null;
        tips.className = 'tips';
        shadow.appendChild(tips);
        function showTips(content, second = 5) {
            if (tipsTimerId) clearTimeout(tipsTimerId);
            tips.style.display = 'block';
            tips.innerText = content;
            tipsTimerId = setTimeout(() => {
                tips.style.display = 'none';
                tipsTimerId = null;
            }, second * 1000)
        }

		function jumpTo(link) {
			if (link) window.location.href = link;
			else {
				showTips('沒有下一頁了哦~');
				localStorage.setItem('reader_mode', 'close');
				setTimeout(() => {
					location.reload();
				}, 2*1000);
			}
		}


        // icon svg
        const downIcon = '<svg viewBox="0 0 24 24" width="48" height="48" fill="var(--main-text-color)" aria-hidden="true" ><path d="m15.293 10.293-2.94 2.94a.5.5 0 0 1-.707 0l-2.939-2.94a1 1 0 0 0-1.414 1.414l2.94 2.94a2.5 2.5 0 0 0 3.535 0l2.94-2.94a1 1 0 0 0-1.415-1.414z"></path><path d="M12 .5C5.649.5.5 5.649.5 12S5.649 23.5 12 23.5 23.5 18.351 23.5 12 18.351.5 12 .5zM2.5 12a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z"></path></svg>'
        const upIcon = '<svg viewBox="0 0 24 24" width="48" height="48" fill="var(--main-text-color)" aria-hidden="true" ><path d="m8.707 13.707 2.94-2.94a.5.5 0 0 1 .707 0l2.939 2.94a1 1 0 0 0 1.414-1.414l-2.94-2.94a2.5 2.5 0 0 0-3.535 0l-2.94 2.94a1 1 0 0 0 1.415 1.414z"></path><path d="M12 .5C5.649.5.5 5.649.5 12S5.649 23.5 12 23.5s11.5-5.149 11.5-11S18.351.5 12 .5zM2.5 12a9.5 9.5 0 1 1 19 0A9.5 9.5 0 0 1 2.5 12z"></path></svg>';
        const endIcon = `<svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg"><g  fill="none" stroke="var(--main-text-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle r="21" cx="24" cy="24"/><path d="m17 18l7 7l7-7 m-14 14 l14 0"/></g></svg>`;
        const plusIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://w3.org"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM12.0018 8C12.5541 8.00014 13.0017 8.44797 13.0015 9.00026L13.001 11.0005L14.9997 11C15.552 10.9999 15.9999 11.4475 16 11.9997C16.0001 12.552 15.5525 12.9999 15.0003 13L13.0005 13.0005L13 15.0003C12.9999 15.5525 12.552 16.0001 11.9997 16C11.4475 15.9999 10.9999 15.552 11 14.9997L11.0005 13.001L9.00025 13.0015C8.44797 13.0017 8.00014 12.5541 8 12.0018C7.99986 11.4495 8.44746 11.0017 8.99975 11.0015L11.001 11.001L11.0015 8.99974C11.0017 8.44746 11.4495 7.99986 12.0018 8Z" fill="#333333"></path></svg>`;
        const minusIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://w3.org"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM15.0003 13C15.5525 12.9999 16.0001 12.552 16 11.9997C15.9999 11.4475 15.552 10.9999 14.9997 11L8.99975 11.0015C8.44746 11.0017 7.99986 11.4495 8 12.0018C8.00014 12.5541 8.44797 13.0017 9.00025 13.0015L15.0003 13Z" fill="#333333"></path></svg>`;
        const exitIcon = `<svg style="width:18px; height:18px; vertical-align:middle;" viewBox="0 0 512 512" fill="white"><path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1L128 320c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l192 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z"/></svg>`;

        // 頁面捲動按鈕(Page Up, Page Down, Page End)
        const pageScrollContainer = document.createElement('div');
        pageScrollContainer.className = 'page-scroll-container';
        pageScrollContainer.style.transform = 'translateY(-50%)';
        pageScrollContainer.innerHTML = `
            <button class="page-btn" id="page-up-btn" title="Page Up" disabled>${upIcon}</button>
            <button class="page-btn" id="page-down-btn" title="Page Down">${downIcon}</button>
            <button class="page-btn" id="page-end-btn" title="PageEnd">${endIcon}</button>
        `;
        shadow.appendChild(pageScrollContainer);

        // 頁面捲動按鈕事件
        pageScrollContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        pageScrollContainer.addEventListener('mouseup', (e) => {
            e.stopPropagation();
        });
        pageScrollContainer.querySelector('#page-up-btn').addEventListener('click', (e) => {
            host.scrollBy({
                top: -window.innerHeight * 0.9,
                behavior: 'smooth'
            });
        });
        pageScrollContainer.querySelector('#page-down-btn').addEventListener('click', (e) => {
            host.scrollBy({
                top: window.innerHeight * 0.9,
                behavior: 'smooth'
            });
        });
        pageScrollContainer.querySelector('#page-end-btn').addEventListener('click', (e) => {
            host.scrollTo({
                top: host.scrollHeight - window.innerHeight * 1.7
            });
        });
    
        // 監聽container的resize事件, 小於1000px則隱藏按鈕
        /*
        const resizeObserver = new ResizeObserver(() => {
            if (window.innerWidth < 1000) {
                pageScrollContainer.style.display = 'none';
            } else {
                pageScrollContainer.style.display = 'flex';
            }
        });
        resizeObserver.observe(container);
        */

        // 控制面板(捲動、字體、配色、關閉)
        const controls = document.createElement('div');
        controls.className = 'controls';
        controls.innerHTML = `
            <button id="auto-scroll-toggle" style="width:80px; height:40px; font-size:18px; color:#e67e22;">▶ 捲動</button>
            <span id="speed-panel">
                <button id="speed-minus">${minusIcon}</button>
                <label id="speed-value">0.3</label>
                <button id="speed-plus">${plusIcon}</button>
            </span>
            <span id ="font-panel">
                <button id="font-minus">${minusIcon}</button>
				<label id="font-txt">${currentSize}px</label>
                <button id="font-plus">${plusIcon}</button>
            </span>
            <button id="color-picker" style="width:45px; height:35px; background: linear-gradient(-45deg, var(--main-bg-color) 60%, var(--main-text-color) 40%); border: 1px solid #000;" border-radius="0px" title="切換配色"></button>
            <button id="reader-close" style="width:50px; height:40px; color:#fff; background:#800; border:none; margin-left:10px;" title="關閉閱讀模式">${exitIcon}</button>
        `;
        shadow.appendChild(controls);

        const colorOptions = document.createElement('div');
        colorOptions.className = 'color-options';
        colorOptions.style.display = 'none';
        colorOptions.innerHTML = `
            <a class="color-cb" data-bg="#111111" data-fc="#a0a0a0" style="background: linear-gradient(-45deg, #111111 60%, #a0a0a0 40%);"></a>
            <a class="color-cb" data-bg="#363b40" data-fc="#b8bfc6" style="background: linear-gradient(-45deg, #363b40 60%, #b8bfc6 40%);"></a>
            <a class="color-cb" data-bg="#DCDCDC" data-fc="#191919" style="background: linear-gradient(-45deg, #DCDCDC 60%, #191919 40%);"></a>
            <a class="color-cb" data-bg="#EFE7CD" data-fc="#191919" style="background: linear-gradient(-45deg, #EFE7CD 60%, #191919 40%);"></a>
            <a class="color-cb" data-bg="#D6EDD6" data-fc="#191919" style="background: linear-gradient(-45deg, #D6EDD6 60%, #191919 40%);"></a>
            <a class="color-cb" data-bg="#DCEAEE" data-fc="#191919" style="background: linear-gradient(-45deg, #DCEAEE 60%, #191919 40%);"></a>
        `;
        shadow.appendChild(colorOptions);

        // 控制面板自動隱藏邏輯：5秒無操作後淡出，移動到控制面板上則取消隱藏，離開則重新計時
        let ctrlHiddenTimeout = null;
        ctrlHiddenTimeout = setTimeout(() => {
            controls.style.opacity = '0';
            controls.style.pointerEvents = 'none';
        }, 5000);

        const speedStep = 0.1;
        const updateFontSize = (size) => {
            const scrollPercent = host.scrollTop / host.scrollHeight;
            host.style.setProperty('--main-font-size', `${size}px`);
            shadow.getElementById('font-txt').innerText = `${size}px`;
            localStorage.setItem('reader_font_size', size);
            setTimeout(() => {
                host.scrollTop = host.scrollHeight * scrollPercent;
            }, 10);
        };

        controls.addEventListener('mouseenter', () => {
            if (ctrlHiddenTimeout) {
                clearTimeout(ctrlHiddenTimeout);
                ctrlHiddenTimeout = null;
            }
            controls.style.opacity = '1';
            controls.style.pointerEvents = 'auto';
        });
        controls.addEventListener('mouseleave', () => {
            if (ctrlHiddenTimeout) clearTimeout(ctrlHiddenTimeout); 
            ctrlHiddenTimeout = setTimeout(() => {
                controls.style.opacity = '0';
                controls.style.pointerEvents = 'none';
            }, 5000);
        });
        controls.addEventListener('mousedown', e => {
            e.stopPropagation();
            if (ctrlHiddenTimeout) {
                clearTimeout(ctrlHiddenTimeout);
                ctrlHiddenTimeout = null;
            }
            console.log('控制面板被點擊，已取消自動隱藏');
        });
        controls.addEventListener('mouseup', e => {
            e.stopPropagation();
        });
        controls.querySelector('#reader-close').addEventListener('click', () => {
            localStorage.setItem('reader_mode', 'close');
            location.reload();
        });
        controls.querySelector('#font-plus').addEventListener('click', () => {
            currentSize = Math.min(60, currentSize + 1);
            updateFontSize(currentSize);
        });
        controls.querySelector('#font-minus').addEventListener('click', () => {
            currentSize = Math.max(16, currentSize - 1);
            updateFontSize(currentSize);
        });
        controls.querySelector('#color-picker').addEventListener('click', () => {
            colorOptions.style.display = colorOptions.style.display === 'none' ? 'block' : 'none';
        });
        colorOptions.addEventListener('click', e => {
            e.stopPropagation();
            colorOptions.style.display = 'none';
        });
        colorOptions.addEventListener('mouseup', e => {
            e.stopPropagation();
        });
        colorOptions.querySelectorAll('.color-cb').forEach(cb => {
            cb.addEventListener('click', e => {
                host.style.setProperty('--main-bg-color', cb.dataset.bg);
                host.style.setProperty('--main-text-color', cb.dataset.fc);
                localStorage.setItem('reader_bg_color', cb.dataset.bg);
                localStorage.setItem('reader_text_color', cb.dataset.fc);
            });
        });
        controls.querySelector('#auto-scroll-toggle').addEventListener('click', (e) => {
            isScrolling ? stopScrolling() : startScrolling();
        });
        controls.querySelector('#speed-plus').addEventListener('click', (e) => {
            if (!isScrolling) return;
            scrollSpeed += speedStep;
            localStorage.setItem('scroll_speed', scrollSpeed);
            updateScrollUI();
        });
        controls.querySelector('#speed-minus').addEventListener('click', (e) => {
            if (!isScrolling) return;
            scrollSpeed = Math.max(0.1, scrollSpeed - speedStep);
            localStorage.setItem('scroll_speed', scrollSpeed);
            updateScrollUI();
        });
        
        //--- 自動捲動邏輯 ---
        let isScrolling = localStorage.getItem('is_scrolling') === 'true';
        let scrollRequest = null;
        let currentY = host.scrollTop;
        let scrollSpeed = parseFloat(localStorage.getItem('scroll_speed')) || 0.3;
        function updateScrollUI() {
            const autoScrollToggle = shadow.getElementById('auto-scroll-toggle');
            autoScrollToggle.innerText = isScrolling ? " ⏸ 停止" : " ▶ 捲動";
            autoScrollToggle.style.color = isScrolling ? "#e67e22" : "#27ae60";

            shadow.getElementById('speed-value').innerText = `${scrollSpeed.toFixed(1)}`;
            shadow.getElementById('speed-panel').style.display = isScrolling ? 'inline-flex' : 'none';
            shadow.getElementById('font-panel').style.display = !isScrolling ? 'inline-flex' : 'none';
        }
        function autoScroll() {
            if (!isScrolling) return;
            currentY += scrollSpeed;
            const contentHeight = host.scrollHeight - window.innerHeight;
            if (currentY >= contentHeight) {
                stopScrolling();
                showTips('到底了', 20);
                return;
            }
            host.scrollTo(0, currentY);
            scrollRequest = requestAnimationFrame(autoScroll);
        }
        function startScrolling() {
            isScrolling = true;
            localStorage.setItem('is_scrolling', true);
            currentY = host.scrollTop;
            autoScroll();
            updateScrollUI();
        }
        function stopScrolling() {
            isScrolling = false;
            localStorage.setItem('is_scrolling', false);
            cancelAnimationFrame(scrollRequest);
            updateScrollUI();
        }

 
        // 中斷自動捲動的條件：使用者手動滾動、點擊頁面、按下鍵盤或觸控螢幕
        host.addEventListener('wheel', (event) => {
            if (isScrolling) stopScrolling();
        });

        let selectedText = "";
        const { html } = pinyinPro;
        const speaker = new ConsistentLongTextSpeaker();

        // 文字選取後的選單
        const textSelectionOptions = document.createElement("div");
        textSelectionOptions.id = "text-selection-options";
        textSelectionOptions.innerHTML = `
            <button id="option1">複製</button>
            <button id="option2">搜尋</button>
            <button id="option3">朗讀</button>
            <button id="option4">翻譯</button>
            <button id="option5">拼音</button>
        `;
        shadow.appendChild(textSelectionOptions);

        // 彈窗: 顯示拼音結果
        const pinyinPopup = document.createElement("div");
        pinyinPopup.id = "pinyin-popup";
        pinyinPopup.innerHTML = `
            <div id="pinyin-popup-header">
                <span id="pinyin-popup-title" style="border-top-left-radius: 8px;">pinyin</span>
                <button id="close-pinyin-popup" style="border-top-right-radius: 8px;">X</button>
            </div>
            <div id="pinyin-popup-content"></div>
        `;
        shadow.appendChild(pinyinPopup);
        
        // 讓popup可以拖動
        const pinyinPopupHeader = pinyinPopup.querySelector("#pinyin-popup-header");
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let savedSelection = null; // 用來暫存文字選取範圍
        pinyinPopupHeader.addEventListener("mousedown", (e) => {
            e.preventDefault();

            // 暫存當前的文字選取範圍，避免拖動過程中選取消失
            const selection = shadow.getSelection();
            if (selection.rangeCount > 0) {
                savedSelection = selection.getRangeAt(0).cloneRange();
            }

            isDragging = true;
            const rect = pinyinPopup.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
        });
        host.addEventListener("mousemove", (e) => {
            if(!isDragging) return;

            // 移動時防止滑鼠選取到畫面上的其他文字
            e.preventDefault();

            pinyinPopup.style.left = `${e.clientX - dragOffsetX}px`;
            pinyinPopup.style.top = `${e.clientY - dragOffsetY}px`;
            
            // 在移動過程中，不斷強制將選取狀態補回來
            if (savedSelection) {
                const selection = shadow.getSelection();
                selection.removeAllRanges();
                selection.addRange(savedSelection);
            }
        });
        
        // 文字選取後的選單事件
        //--- 複製
        textSelectionOptions.querySelector("#option1").addEventListener("click", e => {
            navigator.clipboard.writeText(selectedText).then(() => {
                shadow.getSelection().removeAllRanges();
                textSelectionOptions.style.display = "none";
                pinyinPopup.style.display = "none";
                showTips("已複製到剪貼簿！", 2);
            });
        });
        //--- 搜尋
        textSelectionOptions.querySelector("#option2").addEventListener("click", e => {
            const query = encodeURIComponent(selectedText);
            window.open(`https://www.google.com/search?q=${query}`, '_blank');
        });
        //--- 朗讀
        textSelectionOptions.querySelector("#option3").addEventListener("click", e => {
            speaker.speak(selectedText);
        });
        //--- 翻譯
        textSelectionOptions.querySelector("#option4").addEventListener("click", e => {
            const query = encodeURIComponent(selectedText);

            // 有中文則翻譯成英文，沒有中文則翻譯成中文
            const targetLang = /[\u4e00-\u9fa5]/.test(selectedText) ? 'en' : 'zh-TW';
            window.open(`https://translate.google.com/?sl=auto&tl=${targetLang}&op=translate&text=${query}`, '_blank');
        });
        //--- 拼音
        textSelectionOptions.querySelector("#option5").addEventListener("click", e => {
            if(pinyinPopup.style.display === "block") {
                pinyinPopup.style.display = "none";
                return;
            }
            pinyinPopup.style.display = "block";
            const centerX = window.innerWidth / 2 - pinyinPopup.offsetWidth / 2;
            const centerY = window.innerHeight / 2 - pinyinPopup.offsetHeight / 2;
            let { top, left } = localStorage.getItem('pinyin_popup_position') ? JSON.parse(localStorage.getItem('pinyin_popup_position')) : { top: centerY, left: centerX };
            if(top + pinyinPopup.offsetHeight > window.innerHeight) {
                top = window.innerHeight - pinyinPopup.offsetHeight - 20;
            }
            else if (top < 20) {
                top = 20;
            }
            if(left + pinyinPopup.offsetWidth > window.innerWidth) {
                left = window.innerWidth - pinyinPopup.offsetWidth - 20;
            }
            else if (left < 20) {
                left = 20;
            }
            pinyinPopup.style.top = `${top}px`;
            pinyinPopup.style.left = `${left}px`;       
        });    
        //--- 關閉彈窗
        pinyinPopup.querySelector("#close-pinyin-popup").addEventListener("click", e => {
            pinyinPopup.style.display = "none";
        }); 
        // 阻止選單內的點擊事件冒泡，避免觸發host的mouseup事件導致control面板的顯示/隱藏
        textSelectionOptions.addEventListener("mousedown", e => {
            e.stopPropagation();
        });
        textSelectionOptions.addEventListener("mouseup", e => {
            e.stopPropagation();
        });

 
        // 監聽文字選取變化，動態更新選取的文字內容；如果沒有選取任何文字，則隱藏選單與彈窗
        host.addEventListener('selectionchange', () => {
            const selection = shadow.getSelection();
            selectedText = selection.toString().trim();

            // 如果畫面上沒有選取任何文字，立刻隱藏選單與彈窗
            if (selectedText.length === 0) {
                textSelectionOptions.style.display = "none";
                pinyinPopup.style.display = "none";
            }
        });

        // 監聽滑鼠事件：選取文字顯示選單，點擊空白處切換控制面板顯示
        host.addEventListener('mouseup', e => {
            if (isDragging) {
                isDragging = false;
                localStorage.setItem('pinyin_popup_position', JSON.stringify({ top: pinyinPopup.offsetTop, left: pinyinPopup.offsetLeft }));
                return;
            }
            setTimeout(() => {
                const selection = shadow.getSelection();
                // 獲取選取的文字
                selectedText = selection.toString().trim();
                // 如果有選取文字，則顯示選單
                if (selectedText.length > 0) {
                    /*if(textSelectionOptions.style.display === 'flex') {
                        return;
                    }*/
                    textSelectionOptions.style.display = "flex";
                    const rect = selection.getRangeAt(0).getBoundingClientRect();
                    if(rect.top < 60) {
                        textSelectionOptions.style.top = `${rect.bottom + 10}px`;
                    }
                    else {
                        textSelectionOptions.style.top = `${rect.top - textSelectionOptions.offsetHeight - 10}px`;
                    }
                    const newLeft = rect.right - textSelectionOptions.offsetWidth / 2;
                    if(newLeft + textSelectionOptions.offsetWidth > window.innerWidth) {
                        textSelectionOptions.style.left = `${window.innerWidth - textSelectionOptions.offsetWidth - 20}px`;
                    } 
                    else {
                        textSelectionOptions.style.left = `${newLeft}px`;
                    }
                    // 更新彈窗內容
                    const pinyinPopupContent = pinyinPopup.querySelector("#pinyin-popup-content");
                    const sentences = selectedText.split(/([。？！；…\n\r]|\,\s*)/g)
                            .map(s => s.trim())
                            .filter(s => s.length > 0)
                            .reduce((acc, current) => {
                                const punctuations = ["。", "？", "！", "；", "…", ",", "”", "“", "‘", "’"];
                                if (punctuations.includes(current) && acc.length > 0) {
                                    acc[acc.length - 1] += current;
                                } else {
                                    acc.push(current);
                                }
                                return acc;
                            }, []);
                    let pinyinHtml = "";
                    sentences.forEach(sentence => {
                        pinyinHtml += html(sentence)+"<br>";
                    });
                    pinyinPopupContent.innerHTML = pinyinHtml;
                }
                // 點擊空白處切換控制面板顯示
                else {       
                    if(textSelectionOptions.style.display === 'flex') {
                        textSelectionOptions.style.display = "none";
                        pinyinPopup.style.display = "none";
                        return;
                    }                      

                    if (controls.style.opacity == '0') {
                        if (isScrolling) stopScrolling();
                        controls.style.opacity = '1';
                        controls.style.pointerEvents = 'auto';
                    } else {
                        if (!colorOptions.contains(e.target)) {
                            colorOptions.style.display = 'none';
                        }
                        else {
                            return;
                        }
                        controls.style.opacity = '0';
                        controls.style.pointerEvents = 'none';
                    }
                }
            }, 100);
        });
       
        let lastScrollY = host.scrollTop;
        let scrollTimeoutId = null;
        let isJumping = false; // 跳轉鎖定狀態
        host.addEventListener('scroll', () => {
            // 按鈕禁用邏輯
            pageScrollContainer.querySelector('#page-up-btn').disabled = host.scrollTop === 0;
            pageScrollContainer.querySelector('#page-down-btn').disabled = host.scrollTop + window.innerHeight >= host.scrollHeight;

            const currentScrollY = host.scrollTop;       

            // 向下捲動
            if (currentScrollY > lastScrollY) {
                const reachedBottom = host.scrollTop + window.innerHeight >= host.scrollHeight - 100;

                if (reachedBottom && !isJumping) {
                    isJumping = true; // 鎖定,防止重複觸發
                    showTips('到底了，跳轉中⋯', 3);
                    if ( !scrollTimeoutId ) {
                        scrollTimeoutId = setTimeout(() => {
                            jumpTo(nextLink);
                            isJumping = false; // 解鎖
                            scrollTimeoutId = null;
                        }, 3000);
                    }
                }
            } 
            // 向上捲動(取消跳轉)
            else if (currentScrollY < lastScrollY) {
                if (scrollTimeoutId || isJumping) {
                    clearTimeout(scrollTimeoutId);
                    scrollTimeoutId = null;
                    isJumping = false; // 解鎖
                    showTips('已取消跳轉', 3);
                }
            }   
            lastScrollY = currentScrollY;
        });

        window.addEventListener('keydown', (e) => {
            const scrollContainer = host;
            const scrollPage = window.innerHeight * 0.9;
            const scrollLine = 100;

            if (isScrolling) {
                e.preventDefault();
                stopScrolling();
                showTips('自動捲動已中斷');
                return;
            }

            switch (e.code) {
                case 'Escape':
                    e.preventDefault();
                    if (scrollTimeoutId || isJumping) {
                        clearTimeout(scrollTimeoutId);
                        scrollTimeoutId = null;
                        isJumping = false; // 解鎖
                        showTips('已取消跳轉', 3);
                    }
                    else {
                        // 按下Esc且沒有跳轉在等待中，則退出閱讀模式
                        localStorage.setItem('reader_mode', 'close');
                        location.reload();
                    }
                    break;
                case 'Space':
                case 'PageDown':
                    e.preventDefault();
                    scrollContainer.scrollBy({
                        top: scrollPage,
                        behavior: 'smooth'
                    });
                    break;
                case 'PageUp':
                    e.preventDefault();
                    scrollContainer.scrollBy({
                        top: -scrollPage,
                        behavior: 'smooth'
                    });
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    scrollContainer.scrollBy({
                        top: scrollLine,
                        behavior: 'smooth'
                    });
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    scrollContainer.scrollBy({
                        top: -scrollLine,
                        behavior: 'smooth'
                    });
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    jumpTo(nextLink);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    jumpTo(prevLink);
                    break;
            }
        }, true);

        // 手機端的左右滑動事件: 向左滑動跳轉下一頁, 向右滑動跳轉上一頁
        let touchStartX = 0;
        host.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
        }, false);
        host.addEventListener('touchend', e => {
            const swipeDistance = touchStartX - e.changedTouches[0].screenX;
            if (swipeDistance > 50) jumpTo(nextLink);
            if (swipeDistance < -50) jumpTo(prevLink);
        }, false);
       
        // 內容異常檢測: 內容過短或標題包含502錯誤提示, 則認定為提取失敗, 進行重試
        if (article.content.length < 500) {
            //console.log("Article content is short:", article.content.length);
            if(article.content.length === 0 || /502: Bad gateway/i.test(article.title)) { 
                const failedCount = parseInt(localStorage.getItem('load_failed_count') || '0') + 1;
                localStorage.setItem('load_failed_count', failedCount);
                if(failedCount >= 3) {
                    localStorage.removeItem('load_failed_count');
                    localStorage.setItem('reader_mode', 'close');
                    window.location.reload();
                } else {
                    showTips('未能提取到正文內容，正在重試...', 5);
                    setTimeout(() => window.location.reload(), failedCount*1000);
                }
            }
			if(!nextLink && !prevLink) {
                showTips('資料載入可能發生異常，請重載或離開閱讀模式重入。', 30);
            }
        }
        else {
            localStorage.removeItem('load_failed_count');
            if (window.innerWidth >= 1000) {
                pageScrollContainer.style.display = 'flex';
            }
        }

        updateScrollUI();

    }

    function normalizeTitle(title) {
        if (!title) return "";
        const match = title.match(/第\s*([0-9一二三四五六七八九十百千]+)\s*[章回頁页卷]/);
        const content = match ? match[1].trim() : title.trim();
        if (/^\d+$/.test(content)) return parseInt(content).toString();
        const zhMap = { '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
        const unitMap = { '十': 10, '百': 100, '千': 1000 };
        let total = 0, temp = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            if (zhMap[char] !== undefined) temp = zhMap[char];
            else if (unitMap[char] !== undefined) {
                if (temp === 0 && char === '十') temp = 1;
                total += temp * unitMap[char];
                temp = 0;
            }
        }
        return (total + temp).toString();
    }

    function cleanDoc(doc) {
        const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });   
        const titleSelectors = ['h1', 'h2', 'h3', '.subtitle', '.nr_title','.chapter-title', '.title'];      
        const titleRegex = /第.*[章回頁页卷]|【\d+章】|^\d+、/; 
        let extractedTitle = "";
        titleSelectors.some(selector => {
            const el = doc.querySelector(selector);
            if (el) {
                el.querySelectorAll('.review-count').forEach(r => r.remove());
                const text = converter(el.innerText.trim());
                if(titleRegex.test(text)) {
                    extractedTitle = text;
                    return true;
                }
            }
        });

        const trashSelectors = [
            '#reader-set-top', '.read-set', '.directory-link', '.review-count', '#_popIn_recommend', '.bottom_form',
            'a[href*="javascript"]', 'button, h1, h2, ui, li, hr'
        ];
        const trashKeywords = [
            "報錯", "開燈", "關燈", "章節列表", "目錄", "返回", "簡介", 
            "上一章", "下一章", "上一頁", "下一頁", "上一篇", "下一篇", 
            "ADVERTISEMENT", "語音速度", "語音音調", "設置", "背景", "字體", 
            "手機用戶請瀏覽", "閱讀完整內容", "加入書籤", "投推薦票"
        ];
        trashSelectors.forEach(s => doc.querySelectorAll(s).forEach(el => el.remove()));
        doc.querySelectorAll('div, p, span, a').forEach(el => {
            const text = converter(el.innerText);
            if (text && trashKeywords.some(k => text.trim() === k)){
                console.log("Removing element with text:", text);
                el.remove();
            }
        });
        const article = new Readability(doc).parse();
        if (!article) return article;
        const slimTitle = (extractedTitle) ? extractedTitle : converter(article.title.split(/[\-_|,]/).find(item => titleRegex.test(item)) || article.title);
        //console.log("Extracted title:", article.title, "=>", slimTitle);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = article.content;
        //console.log("Original article content:", tempDiv.innerHTML);
        let finalizedHtml = "";
        tempDiv.querySelectorAll('p').forEach(p => {
            //console.log("Original paragraph:", p.innerHTML);
            const segments = p.innerHTML.split(/<br\s*\/?>/i);
            segments.forEach(function (segment) {
                //console.log("Original segment:", segment);
				const tempSegment = document.createElement('div');
				tempSegment.innerHTML = converter(segment);
                //console.log("Processing segment:", tempSegment.innerText);
				const trimmedText = tempSegment.innerText.replace(/&nbsp;|&emsp;|&ensp;|　|  /g, '').trim();
				if (trimmedText.length > 0) {
					const spamRegex = /[8⑧⑻⒏８][bbｂｂBВвьЬＢ][oоσOOΟＯｏОο][oоσOOΟＯｏОο][kккｋККKＫ]/;
					if (spamRegex.test(trimmedText)) return;
                    if (/copyright \d{4}/i.test(trimmedText)) return;
					if (/黃金屋|最新的小說章節|最新章節|提供最快更新|我的書城|臺灣小[說説]網|記住首發網站域名|本書由.*全網首發/.test(trimmedText)) return;
					if (/twkan/i.test(trimmedText)) return;
					const hasDate = /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmedText);
					const isKeywordTrash = trimmedText.length < 10 && trashKeywords.some(k => trimmedText.includes(k));
                    const removeSpaceTitle = slimTitle.replace(/\s+/g, '');
                    const removeSpaceText = trimmedText.replace(/\s+/g, ''); 
					let isTitle = (removeSpaceTitle.includes(removeSpaceText) || removeSpaceText.includes(removeSpaceTitle));
					if (!isTitle) {
						const pureTitle = slimTitle.replace(titleRegex, "").trim();
						const pureTrimmed = trimmedText.replace(titleRegex, "").trim();
						if (pureTitle.length > 0 && pureTitle.includes(pureTrimmed)) isTitle = true;
                        //console.log({ pureTitle, pureTrimmed, isTitle });
                    }
                    //console.log({ trimmedText, hasDate, isKeywordTrash, isTitle });
					if (!hasDate && !isKeywordTrash && !isTitle) finalizedHtml += `<p>${trimmedText}</p>`;
				}
			});
        });
        return {
            title: slimTitle,
            content: finalizedHtml
        };
    }

    function customConverter() {
        // 1. 在這裡設定你的替換規則：['要被換掉的錯字', '換回來的正確字']
        const myDict = [
            ['麵', '面'],
            ['唿', '呼'],
            ['係', '系'],
            ['嗬', '呵'],
            ['隻', '只'],
            ['説', '說'],
            ['賬', '帳'],
            ['迴', '回']
        ];

        // 2. 核心轉換函數：只處理文字節點，保證不破壞網頁結構
        function translateNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                let text = node.nodeValue;
                let changed = false;

                // 逐一檢查字典並替換
                for (const [wrong, right] of myDict) {
                    if (text.includes(wrong)) {
                        text = text.replaceAll(wrong, right); // 全域替換該詞
                        changed = true;
                    }
                }

                if (changed) {
                    node.nodeValue = text;
                }
            } else {
                // 忽略腳本與樣式標籤
                if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
                // 遞迴遍歷子節點
                for (let child of node.childNodes) {
                    translateNode(child);
                }
            }
        }

        // 3. 頁面初次載入時轉換
        translateNode(document.body);

        // 4. 動態網頁支援：監聽滾動加載、下一頁等新載入的內容
        const observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                for (let addedNode of mutation.addedNodes) {
                    translateNode(addedNode);
                }
            }
        });

        // 5. 啟動監聽器
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

    }

    function findNextLink(doc) {
        const keywords = ["下一頁", "下一章", "下一節", "下一回", "下一卷", "下一页", "下一节", '下一篇', "Next", "下頁", "＞", "→", "下一"];
        const links = Array.from(doc.querySelectorAll('a'));
        let found = links.find(a => {
            const text = a.innerText.replace(/\s+/g, '');
            return keywords.some(k => text.includes(k)) && !text.includes("返回") && a.href.startsWith('http');
        });
        if (!found) found = doc.querySelector('a[rel="next"]') || doc.querySelector('.nextPage a') || doc.querySelector('a.next');
        return found ? found.href : null;
    }

    function findPrevLink(doc) {
        const keywords = ["上一頁", "上一章", "上一節", "上一回", "上一卷", "上一页", "上一节", '上一篇', "Prev", "上頁", "上一"];
        const links = Array.from(doc.querySelectorAll('a'));
        let found = links.find(a => {
            const text = a.innerText.replace(/\s+/g, '');
            return keywords.some(k => text.includes(k)) && !text.includes("返回") && a.href.startsWith('http');
        });
        if (!found) found = doc.querySelector('a[rel="Prev"]') || doc.querySelector('.prevPage a') || doc.querySelector('a.prev');
        return found ? found.href : null;
    }

    if (document.readyState === 'complete') setTimeout(initButton, 500);
    else window.addEventListener('load', initButton);

})();
