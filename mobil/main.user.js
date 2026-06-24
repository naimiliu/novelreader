// ==UserScript==
// @name         小說閱讀器(純)
// @namespace    https://github.com/naimiliu/novelreader
// @version      1.2.6
// @description  自動抓取正文，提供字體調整、自動捲動等功能，提升小說閱讀體驗。
// @icon         https://raw.githubusercontent.com/naimiliu/novelreader/main/default.png
// @author       naimiliu
// @match        https://*/*
// @exclude      *://*.google.com.tw/*
// @exclude      *://*.facebook.*/*
// @run-at       document-end
// @require      https://cdnjs.cloudflare.com/ajax/libs/readability/0.6.0/Readability.min.js
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.3.1/dist/umd/full.js
// @resource     NOVEL_CSS https://raw.githubusercontent.com/naimiliu/novelreader/refs/heads/main/mobil/novel-style.css
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @updateURL    https://raw.githubusercontent.com/naimiliu/novelreader/main/mobil/main.user.js
// @downloadURL  https://raw.githubusercontent.com/naimiliu/novelreader/main/mobil/main.user.js
// ==/UserScript==
/* global Readability */
/* global OpenCC */

(function() {
    'use strict';

// =========================================================================
// 模組: 小說閱讀器系統 (NovelUI)
// =========================================================================
const NovelUI = {
    host: null,
    shadow: null,
    nextLink: null,
    prevLink: null,
    controls: null,
    tipsTimerId: null,
    showTips: null,
    currentSize: null,
    isScrolling: null,
    speedStep: null,
    scrollRequest: null,
    autoScrollCurrentY: null,
    scrollSpeed: null,
    init() {
        this.host = document.createElement('div');
        this.host.id = "my-reader-overlay";
        Object.assign(this.host.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            backgroundColor: '#0D0E0E', color: '#90908E', zIndex: '2147483646', overflowY: 'auto',
            WebkitOverflowScrolling: 'touch'
        });
        this.shadow = this.host.attachShadow({ mode: 'open' });
        document.body.appendChild(this.host);
        document.body.style.overflow = 'hidden';

        const style = document.createElement('style');
        style.textContent = GM_getResourceText("NOVEL_CSS");
        this.shadow.appendChild(style);

        this.nextLink = findNextLink(document);
        this.prevLink = findPrevLink(document);
        // ---- 自動捲動相關變數
        this.isScrolling = localStorage.getItem('is_scrolling') === 'true';
        this.speedStep = 0.1;
        this.scrollRequest = null;
        this.autoScrollCurrentY = this.host.scrollTop;
        this.scrollSpeed = parseFloat(localStorage.getItem('scroll_speed')) || 0.3;
        customConverter(); // 簡轉繁
        const article = this.parse();
        if (article) {
            this.renderReader(article);
            this.check(article);
            this.updateScrollUI();
            if (this.isScrolling) {
                let countdown = 10;
                const timer = setInterval(() => {
                    this.showTips(`將于 ${--countdown} 秒後，開始自動捲動。`, countdown);
                    if (countdown === 0) {
                        clearInterval(timer);
                        this.startScrolling();
                    }
                }, 1000);
            }
        }
    },
    check(article) {
        // 內容異常檢測: 內容過短或標題包含502錯誤提示, 則認定為提取失敗, 進行重試
        // 網路發生異常
        if (article.content.length < 500) {
            if (article.content.length === 0 || /502: Bad gateway/i.test(article.title)) {
                const failedCount = parseInt(localStorage.getItem('load_failed_count') || '0') + 1;
                localStorage.setItem('load_failed_count', failedCount);
                if (failedCount >= 3) {
                    localStorage.removeItem('load_failed_count');
                    localStorage.setItem('reader_mode', 'close');
                    window.location.reload();
                } else {
                    console.log('未能提取到正文內容，正在重試...', failedCount);
                    setTimeout(() => window.location.reload(), failedCount * 1000);
                }
            }
            if (!this.nextLink && !this.prevLink) {
                alert('資料載入可能發生異常，請重載或離開閱讀模式重入。');
            }
        }
        else {
            localStorage.removeItem('load_failed_count');
        }

    },
    parse() {
        try {
            const docClone = document.cloneNode(true);
            const article = cleanDoc(docClone); // 清除正文之外的內容
            if (article) {
                localStorage.removeItem('reader_retry_cnt'); // 成功後重置重試次數
            } else {
                const retryCnt = parseInt(localStorage.getItem('reader_retry_cnt') || '0');
                localStorage.setItem('reader_retry_cnt', retryCnt + 1);
                if (retryCnt < 3) {
                    setTimeout(() => {
                        this.parse(); // 重新初始化按鈕，讓用戶可以再次嘗試
                    }, retryCnt * 1000);
                }
                else {
                    localStorage.removeItem('reader_retry_cnt'); // 用完即丟
                    localStorage.setItem('reader_mode', 'close');
                    alert("抱歉，已嘗試多次，無法解析此頁面的正文內容。");
                    window.location.reload();
                }
            }
            return article;
        } catch (e) {
            console.error("解析出錯:", e);
            alert("解析出錯，請檢查控制台。");
        }
    },
    renderReader(article) {
        this.currentSize = parseInt(localStorage.getItem('reader_font_size')) || 28;
        const currentColor = localStorage.getItem('reader_text_color') || '#a0a0a0';
        const currentBgColor = localStorage.getItem('reader_bg_color') || '#111111';
        this.host.style.setProperty('--main-font-size', `${this.currentSize}px`);
        this.host.style.setProperty('--main-text-color', currentColor);
        this.host.style.setProperty('--main-bg-color', currentBgColor);


        // 載入小說文章正文容器
        const container = document.createElement('div');
        container.className = 'nr_layout';
        container.innerHTML = `<h1 id="nr_title">${article.title}</h1><div id="nr_content" class="nr_content">${article.content}</div>`;
        this.shadow.appendChild(container);
        // 面板容器
        // --- icon svg
        const settingIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><g fill="none" fill-rule="evenodd"><path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z"/><path fill="var(--main-text-color)" d="M18.5 4a1.5 1.5 0 0 0-3 0v.5H4a1.5 1.5 0 1 0 0 3h11.5V8a1.5 1.5 0 0 0 3 0v-.5H20a1.5 1.5 0 0 0 0-3h-1.5zM4 10.5a1.5 1.5 0 0 0 0 3h1.5v.5a1.5 1.5 0 0 0 3 0v-.5H20a1.5 1.5 0 0 0 0-3H8.5V10a1.5 1.5 0 1 0-3 0v.5zM2.5 18A1.5 1.5 0 0 1 4 16.5h11.5V16a1.5 1.5 0 0 1 3 0v.5H20a1.5 1.5 0 0 1 0 3h-1.5v.5a1.5 1.5 0 0 1-3 0v-.5H4A1.5 1.5 0 0 1 2.5 18"/></g></svg>`
        const downIcon = '<svg viewBox="0 0 24 24" width="48" height="48" fill="var(--main-text-color)" aria-hidden="true" ><path d="m15.293 10.293-2.94 2.94a.5.5 0 0 1-.707 0l-2.939-2.94a1 1 0 0 0-1.414 1.414l2.94 2.94a2.5 2.5 0 0 0 3.535 0l2.94-2.94a1 1 0 0 0-1.415-1.414z"></path><path d="M12 .5C5.649.5.5 5.649.5 12S5.649 23.5 12 23.5 23.5 18.351 23.5 12 18.351.5 12 .5zM2.5 12a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z"></path></svg>'
        const upIcon = '<svg viewBox="0 0 24 24" width="48" height="48" fill="var(--main-text-color)" aria-hidden="true" ><path d="m8.707 13.707 2.94-2.94a.5.5 0 0 1 .707 0l2.939 2.94a1 1 0 0 0 1.414-1.414l-2.94-2.94a2.5 2.5 0 0 0-3.535 0l-2.94 2.94a1 1 0 0 0 1.415 1.414z"></path><path d="M12 .5C5.649.5.5 5.649.5 12S5.649 23.5 12 23.5s11.5-5.149 11.5-11S18.351.5 12 .5zM2.5 12a9.5 9.5 0 1 1 19 0A9.5 9.5 0 0 1 2.5 12z"></path></svg>';
        const endIcon = `<svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg"><g  fill="none" stroke="var(--main-text-color)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle r="21" cx="24" cy="24"/><path d="m17 18l7 7l7-7 m-14 14 l14 0"/></g></svg>`;
        const plusIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://w3.org"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM12.0018 8C12.5541 8.00014 13.0017 8.44797 13.0015 9.00026L13.001 11.0005L14.9997 11C15.552 10.9999 15.9999 11.4475 16 11.9997C16.0001 12.552 15.5525 12.9999 15.0003 13L13.0005 13.0005L13 15.0003C12.9999 15.5525 12.552 16.0001 11.9997 16C11.4475 15.9999 10.9999 15.552 11 14.9997L11.0005 13.001L9.00025 13.0015C8.44797 13.0017 8.00014 12.5541 8 12.0018C7.99986 11.4495 8.44746 11.0017 8.99975 11.0015L11.001 11.001L11.0015 8.99974C11.0017 8.44746 11.4495 7.99986 12.0018 8Z" fill="#333333"></path></svg>`;
        const minusIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://w3.org"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM15.0003 13C15.5525 12.9999 16.0001 12.552 16 11.9997C15.9999 11.4475 15.552 10.9999 14.9997 11L8.99975 11.0015C8.44746 11.0017 7.99986 11.4495 8 12.0018C8.00014 12.5541 8.44797 13.0017 9.00025 13.0015L15.0003 13Z" fill="#333333"></path></svg>`;
        const exitIcon = `<svg style="width:18px; height:18px; vertical-align:middle;" viewBox="0 0 512 512" fill="white"><path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1L128 320c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l192 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z"/></svg>`;

        // --- 控制面板(捲動、字體、配色、關閉)
        this.controls = document.createElement('div');
        this.controls.id = 'controls';
        this.controls.className = 'controls';
        this.controls.innerHTML = `
                <button id="auto-scroll-toggle"></button>
                <span id="speed-panel" class="${this.isScrolling ? 'show' : ''}">
                    <button id="speed-minus">${minusIcon}</button>
                    <label id="speed-value">${this.scrollSpeed.toFixed(1)}</label>
                    <button id="speed-plus">${plusIcon}</button>
                </span>
                <span id ="font-panel" class="${this.isScrolling ? '' : 'show'}">
                    <button id="font-minus">${minusIcon}</button>
                    <label id="font-txt">${this.currentSize}px</label>
                    <button id="font-plus">${plusIcon}</button>
                </span>
                <button id="color-picker" style="width:45px; height:35px; background: linear-gradient(-45deg, var(--main-bg-color) 60%, var(--main-text-color) 40%); border: 1px solid #000;" border-radius="0px" title="切換配色"></button>
                <button id="reader-close" style="width:50px; height:40px; color:#fff; background:#800; border:none; margin-left:10px;" title="關閉閱讀模式">${exitIcon}</button>
            `;
        this.shadow.appendChild(this.controls);

        // --- Setting Button : 切換controls的顯示/隱藏
        const settingContainer = document.createElement('div');
        settingContainer.className = 'setting-container';
        settingContainer.innerHTML = `<button class="setting" id='setting-btn' title="設定">${settingIcon}</button>`;
        this.shadow.appendChild(settingContainer);

        // --- 配色選項面板
        const colorOptions = document.createElement('div');
        colorOptions.className = 'color-options';
        colorOptions.innerHTML = `
                <a class="color-cb" data-bg="#111111" data-fc="#a0a0a0" style="background: linear-gradient(-45deg, #111111 60%, #a0a0a0 40%);"></a>
                <a class="color-cb" data-bg="#363b40" data-fc="#b8bfc6" style="background: linear-gradient(-45deg, #363b40 60%, #b8bfc6 40%);"></a>
                <a class="color-cb" data-bg="#DCDCDC" data-fc="#191919" style="background: linear-gradient(-45deg, #DCDCDC 60%, #191919 40%);"></a>
                <a class="color-cb" data-bg="#EFE7CD" data-fc="#191919" style="background: linear-gradient(-45deg, #EFE7CD 60%, #191919 40%);"></a>
                <a class="color-cb" data-bg="#D6EDD6" data-fc="#191919" style="background: linear-gradient(-45deg, #D6EDD6 60%, #191919 40%);"></a>
                <a class="color-cb" data-bg="#DCEAEE" data-fc="#191919" style="background: linear-gradient(-45deg, #DCEAEE 60%, #191919 40%);"></a>
            `;
        this.shadow.appendChild(colorOptions);

        // --- Navigator 容器(Page Up, Page Down, Page End)
        const navContainer = document.createElement('div');
        navContainer.className = 'nav-container';
        navContainer.style.transform = 'translateY(-50%)';
        console.log(this.host.clientWidth, window.innerWidth);

        settingContainer.style.right = `${window.innerWidth - this.host.clientWidth}px`;
        navContainer.style.right = `${window.innerWidth - this.host.clientWidth}px`;
        navContainer.innerHTML = `
                <button class="page-btn" id="page-home-btn" title="Page Home" style="rotate: 180deg; margin-bottom: 50px;" disabled>${endIcon}</button>
                <button class="page-btn" id="page-up-btn" title="Page Up" disabled>${upIcon}</button>
                <button class="page-btn" id="page-down-btn" title="Page Down">${downIcon}</button>
                <button class="page-btn" id="page-end-btn" title="PageEnd" style="margin-top: 50px;">${endIcon}</button>
            `;
        this.shadow.appendChild(navContainer);

        // 提示訊息元素
        const tips = document.createElement('div');
        tips.className = 'tips';
        this.shadow.appendChild(tips);
        this.showTips = (content, second = 5) => {
            if (this.tipsTimerId) clearTimeout(this.tipsTimerId);
            tips.classList.add('show');
            tips.innerText = content;
            this.tipsTimerId = setTimeout(() => {
                tips.classList.remove('show');
                this.tipsTimerId = null;
            }, second * 1000)
        }

        
        // 監聽事件

        // 點擊控制面板內的按鈕時也取消隱藏，避免操作中面板突然消失
        settingContainer.querySelector('#setting-btn').addEventListener('click', e => {
            this.controls.classList.toggle('show');
            colorOptions.classList.remove('show');
        });
        this.controls.addEventListener('pointerup', e => {
            e.stopPropagation();
            colorOptions.classList.remove('show');
        });
        this.controls.addEventListener('click', e => {
            e.stopPropagation();
            colorOptions.classList.remove('show');
        });
        // --- auto scroll
        this.controls.querySelector('#auto-scroll-toggle').addEventListener('click', e => {
            this.isScrolling ? this.stopScrolling() : this.startScrolling();
        });
        // 中斷自動捲動的條件：使用者手動滾動、點擊頁面、按下鍵盤或觸控螢幕
        this.host.addEventListener('wheel', (event) => {
            if (this.isScrolling) this.stopScrolling();
        });
        // --- scroll speed ++/--
        this.controls.querySelector('#speed-plus').addEventListener('click', e => {
            if (!this.isScrolling) return;
            this.scrollSpeed += this.speedStep;
            localStorage.setItem('scroll_speed', this.scrollSpeed);
            this.updateScrollUI();
        });
        this.controls.querySelector('#speed-minus').addEventListener('click', e => {
            if (!this.isScrolling) return;
            this.scrollSpeed = Math.max(0.1, this.scrollSpeed - this.speedStep);
            localStorage.setItem('scroll_speed', this.scrollSpeed);
            this.updateScrollUI();
        });
        // --- font size++/--
        this.controls.querySelector('#font-plus').addEventListener('click', () => {
            this.currentSize = Math.min(60, this.currentSize + 1);
            this.updateFontSize(this.currentSize);
        });
        this.controls.querySelector('#font-minus').addEventListener('click', () => {
            this.currentSize = Math.max(12, this.currentSize - 1);
            this.updateFontSize(this.currentSize);
        });
        // --- color picker
        this.controls.querySelector('#color-picker').addEventListener('pointerup', (e) => {
            e.stopPropagation();
        });
        this.controls.querySelector('#color-picker').addEventListener('click', (e) => {
            e.stopPropagation();
            colorOptions.classList.toggle('show');
        });
        // === color options
        colorOptions.addEventListener('pointerup', e => {
            e.stopPropagation();
        });
        colorOptions.querySelectorAll('.color-cb').forEach(cb => {
            cb.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                this.host.style.setProperty('--main-bg-color', cb.dataset.bg);
                this.host.style.setProperty('--main-text-color', cb.dataset.fc);
                localStorage.setItem('reader_bg_color', cb.dataset.bg);
                localStorage.setItem('reader_text_color', cb.dataset.fc);
                colorOptions.classList.remove('show');
            });
        });
        // --- close reader
        this.controls.querySelector('#reader-close').addEventListener('click', () => {
            localStorage.setItem('reader_mode', 'close');
            location.reload();
        });

        // 頁面捲動按鈕事件
        navContainer.querySelector('#page-home-btn').addEventListener('click', e => {
            this.host.scrollBy({
                top: -this.host.scrollHeight
            });
        });
        navContainer.querySelector('#page-up-btn').addEventListener('click', e => {
            this.host.scrollBy({
                top: -window.innerHeight * 0.9,
                behavior: 'smooth'
            });
        });
        navContainer.querySelector('#page-down-btn').addEventListener('click', e => {
            this.host.scrollBy({
                top: window.innerHeight * 0.9,
                behavior: 'smooth'
            });
        });
        navContainer.querySelector('#page-end-btn').addEventListener('click', e => {
            this.host.scrollTo({
                top: this.host.scrollHeight - window.innerHeight * 1.7
            });
        });
        // 觸控裝置滑動與點擊事件
        // 觸控裝置: 滑動跳頁.點擊空白處切換控制面板顯示/隱藏
        let touchStartX = 0;
        let touchStartY = 0;
        // 手機端的左右滑動事件: 向左滑動跳轉下一頁, 向右滑動跳轉上一頁
        this.host.addEventListener('pointerdown', e => {
            if (this.isScrolling) this.stopScrolling();
            touchStartX = e.clientX;
            touchStartY = e.clientY;
        });
        this.host.addEventListener('pointerup', e => {
            const deltaX = touchStartX - e.clientX;
            const deltaY = touchStartY - e.clientY;
            // 判斷滑動跳頁 (X 軸位移大於 60px，且 Y 軸垂直偏移小於 40px)
            if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 40) {
                if (deltaX < 0) {
                    this.jumpTo(this.prevLink);
                }
                else {
                    this.jumpTo(this.nextLink);
                }
                return;
            }
        });

        let lastScrollY = this.host.scrollTop;
        let scrollTimeoutId = null;
        let isJumping = false; // 跳轉鎖定狀態
        this.host.addEventListener('scroll', () => {
            // 按鈕禁用邏輯
            navContainer.querySelector('#page-home-btn').disabled = this.host.scrollTop === 0;
            navContainer.querySelector('#page-up-btn').disabled = this.host.scrollTop === 0;
            navContainer.querySelector('#page-down-btn').disabled = this.host.scrollTop + window.innerHeight >= this.host.scrollHeight;

            const currentScrollY = this.host.scrollTop;

            // 向下捲動
            if (currentScrollY > lastScrollY) {
                const reachedBottom = this.host.scrollTop + window.innerHeight >= this.host.scrollHeight - 100;

                if (reachedBottom && !isJumping) {
                    isJumping = true; // 鎖定,防止重複觸發
                    this.showTips('到底了，跳轉中⋯', 3);
                    if (!scrollTimeoutId) {
                        scrollTimeoutId = setTimeout(() => {
                            this.jumpTo(this.nextLink);
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
                    this.showTips('已取消跳轉', 3);
                }
            }
            lastScrollY = currentScrollY;
        }, true);

        window.addEventListener('keydown', e => {
            const scrollContainer = this.host;
            const scrollPage = window.innerHeight * 0.9;
            const scrollLine = 100;

            if (this.isScrolling) {
                e.preventDefault();
                this.stopScrolling();
                this.showTips('自動捲動已中斷');
                return;
            }

            switch (e.code) {
                case 'Escape':
                    e.preventDefault();
                    if (scrollTimeoutId || isJumping) {
                        clearTimeout(scrollTimeoutId);
                        scrollTimeoutId = null;
                        isJumping = false; // 解鎖
                        this.showTips('已取消跳轉', 3);
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
                    this.jumpTo(this.nextLink);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.jumpTo(this.prevLink);
                    break;
            }
        }, true);
    },
    jumpTo(link) { // 頁面跳轉函式

        if (link) window.location.href = link;
        else {
            this.showTips('沒有下一頁了哦~');
            localStorage.setItem('reader_mode', 'close');
            setTimeout(() => {
                window.location.reload();
            }, 2 * 1000);
        }
    },
    //--- 自動捲動邏輯 ---
    updateScrollUI() {
        const autoScrollToggle = this.shadow.getElementById('auto-scroll-toggle');
        autoScrollToggle.classList.toggle('scrolling', this.isScrolling);
        //autoScrollToggle.innerText = this.isScrolling ? " ⏸ 停止" : " ▶ 捲動";
        //autoScrollToggle.style.color = this.isScrolling ? "#e67e22" : "#27ae60";

        this.shadow.getElementById('speed-value').innerText = `${this.scrollSpeed.toFixed(1)}`;
        this.shadow.getElementById('speed-panel').classList.toggle('show', this.isScrolling);
        this.shadow.getElementById('font-panel').classList.toggle('show', !this.isScrolling);
    },
    autoScroll() {
        if (!this.isScrolling) return;
        this.autoScrollCurrentY += this.scrollSpeed;
        const contentHeight = this.host.scrollHeight - window.innerHeight;
        if (this.autoScrollCurrentY >= contentHeight) {
            //this.stopScrolling();
            //this.showTips('到底了', 20);
            return;
        }
        this.host.scrollTo(0, this.autoScrollCurrentY);
        this.scrollRequest = requestAnimationFrame(() => this.autoScroll());
    },
    startScrolling() {
        this.isScrolling = true;
        localStorage.setItem('is_scrolling', true);
        this.autoScrollCurrentY = this.host.scrollTop;
        this.autoScroll();
        this.updateScrollUI();
    },
    stopScrolling() {
        this.isScrolling = false;
        localStorage.setItem('is_scrolling', false);
        cancelAnimationFrame(this.scrollRequest);
        this.updateScrollUI();
    },
    // 更新正文字體大小的函式，並嘗試保持當前閱讀位置不變
    updateFontSize(size) {
        const scrollPercent = this.host.scrollTop / this.host.scrollHeight;

        this.host.style.setProperty('--main-font-size', `${size}px`);
        this.shadow.getElementById('font-txt').innerText = `${size}px`;
        localStorage.setItem('reader_font_size', size);

        setTimeout(() => {
            this.host.scrollTop = this.host.scrollHeight * scrollPercent;
        }, 10);
    }

};

// =========================================================================
// 主控流程：環境判斷與模組協調
// =========================================================================
function main() {
    //bypassPageBlockers();
    // 判斷目前是不是小說頁面:檢查目前網址，不符合則為普通網頁模式
    let isNovelPage = false;
    // 網址規則判斷，只在特定網址啟用閱讀模式
    const urlPattern = /^https?:\/\/[^\/]+\/(read\/\d+_\d+.html$|read\/\d+\/p\d+.html$|read\/\d+\/\??\d+(_\d+){0,1}$|\d+\/\d+(_\d+){0,2}.html$|\d+_\d+\/\d+.html$|chapter\/\d+\/\d+.html$|chapter\/\d+\/\d+\/$|book\/\d+\/\d+.html$|book_\d+\/\d+.html$|Book\/Read\/\d+,\d+$|txt\/\d+\/\d+$|txt\/\d+\/\d+.html$|html\/\d+\/\d+\/\d+.html$|fxnread\/\d+_\d+.html$|n\/\w*\/\d+.html$)/;
    if (urlPattern.test(window.location.href)) {
        isNovelPage = true;
    }

    if (isNovelPage) {
        const readerMode = localStorage.getItem('reader_mode');
        if (readerMode === 'close') {
            localStorage.removeItem('reader_mode'); // 用完即丟
            addReaderButton();
        }
        else {
            NovelUI.init();
        }
    }
}

function addReaderButton() {
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
        window.location.reload();
        /*
        startReader();
        btn.style.display = 'none';
        */
    };
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
    const titleSelectors = ['h1', 'h2', 'h3', '.subtitle', '.nr_title', '.chapter-title', '.title'];
    const titleRegex = /第.*[章回頁页卷]|【\d+章】|^\d+、/;
    let extractedTitle = "";
    titleSelectors.some(selector => {
        const el = doc.querySelector(selector);
        if (el) {
            el.querySelectorAll('.review-count').forEach(r => r.remove());
            const text = converter(el.innerText.trim());
            if (titleRegex.test(text)) {
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
        if (text && trashKeywords.some(k => text.trim() === k)) {
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

function bypassPageBlockers() {
    console.log("[解鎖中樞] 正在強制解除網頁右鍵與防複製限制...");

    // 1. 注入萬能最高優先級 CSS，暴力破解 user-select: none 鎖
    const style = document.createElement('style');
    style.id = 'force-selection-style';
    style.innerHTML = `
        * {
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
            user-select: text !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 2. JS 特權攔截：在「捕獲階段 (true)」搶先攔截並放行所有防禦事件
    const allowEvent = (e) => {
        // 阻止事件繼續向下傳遞給原網站的防禦 JS，使其預設的 preventDefault 破功
        e.stopPropagation();
    };

    document.addEventListener('contextmenu', allowEvent, true);
    document.addEventListener('selectstart', allowEvent, true);
    document.addEventListener('copy', allowEvent, true);
    document.addEventListener('keydown', allowEvent, true); // 防止鎖 Ctrl+C

    // 3. 清理寫在 body 標籤上的行內防禦屬性
    if (document.body) {
        document.body.oncontextmenu = null;
        document.body.onselectstart = null;
        document.body.oncopy = null;
    }
}



// ==============================
if (document.readyState === 'complete') setTimeout(main, 500);
else window.addEventListener('load', main);

})();
