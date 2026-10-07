// ==UserScript==
// @name         BOOTH 衣装チェック管理
// @namespace    booth-outfit-manager
// @version      3.4.3
// @description  BOOTH商品を「気になる」「非表示」で管理。安定した画像ポップアッププレビュー対応。
// @match        https://booth.pm/ja/search/*
// @match        https://booth.pm/*/search/*
// @run-at       document-idle
// @license      MIT
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // 保存キー
    // =========================================================

    const HIDDEN_KEY =
        'booth_seen_items_v2';

    const FAVORITE_KEY =
        'booth_favorite_items_v1';

    const SETTINGS_KEY =
        'booth_outfit_manager_settings_v4';

    const PANEL_COLLAPSED_KEY =
        'booth_outfit_manager_panel_collapsed_v1';


    // =========================================================
    // 設定
    // =========================================================

    const MIN_PREVIEW_SIZE = 250;
    const MAX_PREVIEW_SIZE = 5000;

    const DEFAULT_SETTINGS = {
        previewEnabled: true,
        previewSize: 800,
        previewSliderMax: 1600
    };


    // =========================================================
    // 状態
    // =========================================================

    let currentFilter = 'normal';

    let observer = null;
    let scanTimer = null;

    let previewBox = null;
    let previewImage = null;
    let previewInfo = null;

    let activePreviewCard = null;
    let activePreviewSource = null;

    let pointerX = 0;
    let pointerY = 0;
    let pointerRAF = null;


    // =========================================================
    // Utility
    // =========================================================

    function byId(id) {
        return document.getElementById(id);
    }


    function clamp(value, min, max) {
        return Math.max(
            min,
            Math.min(
                max,
                value
            )
        );
    }


    // =========================================================
    // データ読み書き
    // =========================================================

    function loadData(key) {
        try {
            const raw =
                localStorage.getItem(key);

            return raw
                ? JSON.parse(raw)
                : {};

        } catch (error) {

            console.error(
                '[BOOTH Manager] load error',
                error
            );

            return {};
        }
    }


    function saveData(key, data) {
        localStorage.setItem(
            key,
            JSON.stringify(data)
        );
    }


    // =========================================================
    // 設定
    // =========================================================

    function loadSettings() {
        let data = {};

        try {
            data =
                JSON.parse(
                    localStorage.getItem(
                        SETTINGS_KEY
                    ) || '{}'
                );

        } catch (_) {
            data = {};
        }


        // -----------------------------------------------------
        // 旧バージョン設定を引き継ぐ
        // -----------------------------------------------------

        if (!data.previewSize) {

            const oldKeys = [
                'booth_outfit_manager_settings_v3',
                'booth_outfit_manager_settings_v2',
                'booth_outfit_manager_settings_v1'
            ];

            for (const key of oldKeys) {

                try {
                    const old =
                        JSON.parse(
                            localStorage.getItem(key) ||
                            '{}'
                        );

                    if (
                        old.previewSize &&
                        !data.previewSize
                    ) {
                        data.previewSize =
                            old.previewSize;
                    }

                    if (
                        old.previewSliderMax &&
                        !data.previewSliderMax
                    ) {
                        data.previewSliderMax =
                            old.previewSliderMax;
                    }

                    if (
                        typeof old.previewEnabled ===
                            'boolean' &&
                        typeof data.previewEnabled !==
                            'boolean'
                    ) {
                        data.previewEnabled =
                            old.previewEnabled;
                    }

                } catch (_) {
                    // ignore
                }
            }
        }


        let previewSize =
            Number(
                data.previewSize ||
                DEFAULT_SETTINGS.previewSize
            );

        let previewSliderMax =
            Number(
                data.previewSliderMax ||
                DEFAULT_SETTINGS.previewSliderMax
            );


        previewSize =
            clamp(
                previewSize,
                MIN_PREVIEW_SIZE,
                MAX_PREVIEW_SIZE
            );


        previewSliderMax =
            clamp(
                previewSliderMax,
                MIN_PREVIEW_SIZE,
                MAX_PREVIEW_SIZE
            );


        if (
            previewSize >
            previewSliderMax
        ) {
            previewSliderMax =
                previewSize;
        }


        return {
            previewEnabled:
                data.previewEnabled !== false,

            previewSize,

            previewSliderMax
        };
    }


    function saveSettings(settings) {
        localStorage.setItem(
            SETTINGS_KEY,
            JSON.stringify(settings)
        );
    }


    // =========================================================
    // 非表示
    // =========================================================

    function isHidden(itemId) {
        return Boolean(
            loadData(
                HIDDEN_KEY
            )[itemId]
        );
    }


    function hideItem(
        itemId,
        title
    ) {
        const data =
            loadData(
                HIDDEN_KEY
            );

        data[itemId] = {
            title,

            hiddenAt:
                new Date()
                    .toISOString()
        };


        saveData(
            HIDDEN_KEY,
            data
        );


        // 非表示にしたら「気になる」は解除
        removeFavorite(
            itemId
        );
    }


    function restoreItem(itemId) {
        const data =
            loadData(
                HIDDEN_KEY
            );

        delete data[itemId];

        saveData(
            HIDDEN_KEY,
            data
        );
    }


    // =========================================================
    // 気になる
    // =========================================================

    function isFavorite(itemId) {
        return Boolean(
            loadData(
                FAVORITE_KEY
            )[itemId]
        );
    }


    function addFavorite(
        itemId,
        title
    ) {
        const data =
            loadData(
                FAVORITE_KEY
            );

        data[itemId] = {
            title,

            addedAt:
                new Date()
                    .toISOString()
        };


        saveData(
            FAVORITE_KEY,
            data
        );
    }


    function removeFavorite(itemId) {
        const data =
            loadData(
                FAVORITE_KEY
            );

        delete data[itemId];

        saveData(
            FAVORITE_KEY,
            data
        );
    }


    // =========================================================
    // 商品ID
    // =========================================================

    function getItemId(url) {
        if (!url) {
            return null;
        }

        const match =
            url.match(
                /\/items\/(\d+)/
            );

        return match
            ? match[1]
            : null;
    }


    // =========================================================
    // 要素内の商品ID
    // =========================================================

    function getUniqueItemIds(element) {
        const ids =
            new Set();

        if (!element) {
            return ids;
        }


        element
            .querySelectorAll(
                'a[href*="/items/"]'
            )
            .forEach(
                function (link) {

                    const id =
                        getItemId(
                            link.href
                        );

                    if (id) {
                        ids.add(id);
                    }
                }
            );


        return ids;
    }


    // =========================================================
    // 商品カード検出
    // =========================================================

    function getExistingCard(itemId) {
        return document.querySelector(
            '[data-booth-manager-item-id="' +
            CSS.escape(itemId) +
            '"]'
        );
    }


    function findCard(
        link,
        itemId
    ) {
        const existing =
            getExistingCard(itemId);

        if (existing) {
            return existing;
        }


        let element =
            link;


        for (
            let i = 0;
            i < 10;
            i++
        ) {
            if (
                !element ||
                !element.parentElement
            ) {
                break;
            }


            element =
                element.parentElement;


            const rect =
                element
                    .getBoundingClientRect();


            const images =
                element
                    .querySelectorAll(
                        'img'
                    );


            const links =
                element
                    .querySelectorAll(
                        'a[href*="/items/' +
                        itemId +
                        '"]'
                    );


            if (
                links.length >= 1 &&
                images.length >= 1 &&
                rect.width >= 150 &&
                rect.width <= 460 &&
                rect.height >= 180 &&
                rect.height <= 950
            ) {
                return element;
            }
        }


        return null;
    }


    // =========================================================
    // グリッドセル検出
    // =========================================================

    function findLayoutItem(
        card,
        itemId
    ) {
        const existing =
            document.querySelector(
                '[data-booth-manager-layout-item-id="' +
                CSS.escape(itemId) +
                '"]'
            );


        if (existing) {
            return existing;
        }


        let current =
            card;


        for (
            let depth = 0;
            depth < 7;
            depth++
        ) {
            const parent =
                current.parentElement;


            if (!parent) {
                break;
            }


            const children =
                Array.from(
                    parent.children
                );


            const productChildren =
                children.filter(
                    function (child) {

                        if (
                            !child.querySelector(
                                'img'
                            )
                        ) {
                            return false;
                        }


                        const ids =
                            getUniqueItemIds(
                                child
                            );


                        return (
                            ids.size >= 1 &&
                            ids.size <= 2
                        );
                    }
                );


            if (
                productChildren.length >= 3 &&
                productChildren.includes(
                    current
                )
            ) {
                current.dataset
                    .boothManagerLayoutItemId =
                    itemId;

                return current;
            }


            current =
                parent;
        }


        card.dataset
            .boothManagerLayoutItemId =
            itemId;


        return card;
    }


    // =========================================================
    // 商品タイトル
    // =========================================================

    function getTitle(
        card,
        link,
        itemId
    ) {
        if (
            card.dataset
                .boothManagerTitle
        ) {
            return card.dataset
                .boothManagerTitle;
        }


        let title =
            link?.textContent
                ?.trim() ||
            '';


        if (!title) {

            const candidates =
                card.querySelectorAll(
                    'a[href*="/items/' +
                    itemId +
                    '"]'
                );


            for (
                const candidate
                of candidates
            ) {
                const text =
                    candidate
                        .textContent
                        .trim();


                if (
                    text.length >
                    title.length
                ) {
                    title =
                        text;
                }
            }
        }


        if (!title) {
            title =
                'BOOTH Item ' +
                itemId;
        }


        card.dataset
            .boothManagerTitle =
            title;


        return title;
    }


    // =========================================================
    // 価格エリア
    // =========================================================

    function findPriceSection(card) {
        const walker =
            document.createTreeWalker(
                card,
                NodeFilter.SHOW_TEXT
            );


        let node;


        while (
            (
                node =
                walker.nextNode()
            )
        ) {
            const text =
                node.nodeValue
                    ?.trim() ||
                '';


            if (
                !/[¥￥]\s*[\d,]+/
                    .test(text)
            ) {
                continue;
            }


            let element =
                node.parentElement;


            let safety =
                0;


            while (
                element &&
                element.parentElement !==
                    card &&
                safety < 12
            ) {
                element =
                    element.parentElement;

                safety++;
            }


            if (
                element &&
                element.parentElement ===
                    card
            ) {
                return element;
            }
        }


        return null;
    }


    // =========================================================
    // 操作ボタン
    // =========================================================

    function ensureActionArea(
        card,
        itemId
    ) {
        let area =
            card.querySelector(
                ':scope > .booth-manager-actions'
            );


        if (!area) {
            area =
                document.createElement(
                    'div'
                );

            area.className =
                'booth-manager-actions';

            area.dataset.itemId =
                itemId;
        }


        const priceSection =
            findPriceSection(
                card
            );


        if (priceSection) {

            if (
                area.nextElementSibling !==
                    priceSection ||
                area.parentElement !==
                    card
            ) {
                card.insertBefore(
                    area,
                    priceSection
                );
            }

        } else if (
            area.parentElement !==
            card
        ) {

            card.appendChild(
                area
            );
        }


        return area;
    }


    function updateActionArea(
        card,
        itemId,
        title
    ) {
        const area =
            ensureActionArea(
                card,
                itemId
            );


        const hidden =
            isHidden(
                itemId
            );


        const favorite =
            isFavorite(
                itemId
            );


        const state =
            hidden
                ? 'hidden'
                : favorite
                    ? 'favorite'
                    : 'normal';


        // 状態が変わっていなければDOMを触らない
        if (
            area.dataset.state ===
            state
        ) {
            return;
        }


        area.dataset.state =
            state;


        area.replaceChildren();


        // -----------------------------------------------------
        // 非表示済み
        // -----------------------------------------------------

        if (hidden) {

            const restore =
                document.createElement(
                    'button'
                );


            restore.type =
                'button';


            restore.className =
                'booth-manager-button restore';


            restore.textContent =
                '↩ 元に戻す';


            restore.addEventListener(
                'click',
                function (event) {

                    event.preventDefault();
                    event.stopPropagation();


                    restoreItem(
                        itemId
                    );


                    delete area
                        .dataset
                        .state;


                    updateCard(
                        card,
                        itemId,
                        title
                    );


                    updatePanel();
                }
            );


            area.appendChild(
                restore
            );


            return;
        }


        // -----------------------------------------------------
        // 気になる
        // -----------------------------------------------------

        const favoriteButton =
            document.createElement(
                'button'
            );


        favoriteButton.type =
            'button';


        favoriteButton.className =
            'booth-manager-button favorite';


        favoriteButton.textContent =
            favorite
                ? '★ 気になる'
                : '☆ 気になる';


        if (favorite) {
            favoriteButton
                .classList
                .add(
                    'active'
                );
        }


        favoriteButton.addEventListener(
            'click',
            function (event) {

                event.preventDefault();
                event.stopPropagation();


                if (
                    isFavorite(
                        itemId
                    )
                ) {
                    removeFavorite(
                        itemId
                    );

                } else {

                    addFavorite(
                        itemId,
                        title
                    );
                }


                delete area
                    .dataset
                    .state;


                updateCard(
                    card,
                    itemId,
                    title
                );


                updatePanel();
            }
        );


        // -----------------------------------------------------
        // 非表示
        // -----------------------------------------------------

        const hideButton =
            document.createElement(
                'button'
            );


        hideButton.type =
            'button';


        hideButton.className =
            'booth-manager-button hide';


        hideButton.textContent =
            '🙈 非表示';


        hideButton.addEventListener(
            'click',
            function (event) {

                event.preventDefault();
                event.stopPropagation();


                hidePreview();


                hideItem(
                    itemId,
                    title
                );


                delete area
                    .dataset
                    .state;


                updateCard(
                    card,
                    itemId,
                    title
                );


                updatePanel();
            }
        );


        area.append(
            favoriteButton,
            hideButton
        );
    }


    // =========================================================
    // 表示制御
    // =========================================================

    function applyVisibility(
        card,
        itemId
    ) {
        const hidden =
            isHidden(
                itemId
            );


        const favorite =
            isFavorite(
                itemId
            );


        const layout =
            findLayoutItem(
                card,
                itemId
            );


        card.classList.remove(
            'booth-manager-favorite-card',
            'booth-manager-hidden-card'
        );


        // -----------------------------------------------------
        // 通常
        // -----------------------------------------------------

        if (
            currentFilter ===
            'normal'
        ) {
            layout.style.display =
                hidden
                    ? 'none'
                    : '';


            if (
                favorite &&
                !hidden
            ) {
                card.classList.add(
                    'booth-manager-favorite-card'
                );
            }


            return;
        }


        // -----------------------------------------------------
        // 気になるだけ
        // -----------------------------------------------------

        if (
            currentFilter ===
            'favorite'
        ) {
            const visible =
                favorite &&
                !hidden;


            layout.style.display =
                visible
                    ? ''
                    : '';


            if (!visible) {
                layout.style.display =
                    'none';
            }


            if (visible) {
                card.classList.add(
                    'booth-manager-favorite-card'
                );
            }


            return;
        }


        // -----------------------------------------------------
        // 全表示
        // -----------------------------------------------------

        layout.style.display =
            '';


        if (hidden) {
            card.classList.add(
                'booth-manager-hidden-card'
            );
        }


        if (
            favorite &&
            !hidden
        ) {
            card.classList.add(
                'booth-manager-favorite-card'
            );
        }
    }


    // =========================================================
    // 1商品更新
    // =========================================================

    function updateCard(
        card,
        itemId,
        title
    ) {
        applyVisibility(
            card,
            itemId
        );


        updateActionArea(
            card,
            itemId,
            title
        );
    }


    // =========================================================
    // 商品スキャン
    // =========================================================

    function scanProducts() {
        const links =
            document.querySelectorAll(
                'a[href*="/items/"]'
            );


        const processed =
            new Set();


        for (
            const link
            of links
        ) {
            if (
                link.closest(
                    '.booth-manager-actions'
                )
            ) {
                continue;
            }


            const itemId =
                getItemId(
                    link.href
                );


            if (
                !itemId ||
                processed.has(
                    itemId
                )
            ) {
                continue;
            }


            const card =
                findCard(
                    link,
                    itemId
                );


            if (!card) {
                continue;
            }


            processed.add(
                itemId
            );


            card.dataset
                .boothManagerItemId =
                itemId;


            const title =
                getTitle(
                    card,
                    link,
                    itemId
                );


            findLayoutItem(
                card,
                itemId
            );


            updateCard(
                card,
                itemId,
                title
            );
        }


        updatePanel();
    }


    // =========================================================
    // カード再描画
    // =========================================================

    function refreshCards() {
        document
            .querySelectorAll(
                '[data-booth-manager-item-id]'
            )
            .forEach(
                function (card) {

                    const itemId =
                        card.dataset
                            .boothManagerItemId;


                    if (!itemId) {
                        return;
                    }


                    const title =
                        card.dataset
                            .boothManagerTitle ||
                        (
                            'BOOTH Item ' +
                            itemId
                        );


                    updateCard(
                        card,
                        itemId,
                        title
                    );
                }
            );


        updatePanel();
    }


    // =========================================================
    // ★ 商品カード内のメイン画像取得
    // =========================================================

    // 実DOMでは商品画像は a の background-image。img はバッジ等にも使われる。
    // 調査が必要な場合だけ true にして保存・再読み込みする。保存データは変更しない。
    const PREVIEW_DEBUG = false;
    let previewDebugStage = '';
    let activePreviewUrl = '';
    let previewObservedCard = null;
    const previewSourceObserver = new MutationObserver(() => {
        // BOOTHの画像切替がpointermoveより後でも、DOM変更後に再判定する。
        // ポップアップは監視対象のカード外なので自己更新ループは起きない。
        schedulePreviewUpdate();
    });

    function schedulePreviewUpdate() {
        if (pointerRAF === null) pointerRAF = requestAnimationFrame(handlePointerPosition);
    }

    function observePreviewCard(card) {
        if (previewObservedCard === card) return;
        previewSourceObserver.disconnect();
        previewObservedCard = card;
        previewSourceObserver.observe(card, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'src', 'srcset', 'data-original', 'data-src', 'hidden']
        });
    }

    function previewDebug(stage, details = {}) {
        if (!PREVIEW_DEBUG || stage === previewDebugStage) return;
        previewDebugStage = stage;
        console.debug('[BOOTH Preview]', stage, details);
    }

    function getBestImageUrl(element) {
        if (!element) return '';
        const background = getComputedStyle(element).backgroundImage;
        const match = background.match(/url\(\s*["']?(.*?)["']?\s*\)/i);
        const raw = element.tagName === 'IMG'
            ? (element.currentSrc || element.getAttribute('src') || element.getAttribute('data-src'))
            : (match?.[1] || element.getAttribute('data-original'));
        if (!raw) return '';
        try {
            const url = new URL(raw, document.baseURI);
            return /^https?:$/.test(url.protocol) ? url.href : '';
        } catch (_) {
            return '';
        }
    }

    function findPrimaryImage(card, hitElements = []) {
        // 商品リンク内だけを調べ、ショップアイコン・バッジは候補にしない。
        const candidates = card.querySelectorAll('a[href*="/items/"], a[href*="/items/"] img');
        let best = null;
        let bestArea = 0;
        const visibleImages = new Set();
        for (const element of candidates) {
            const link = element.closest('a[href*="/items/"]');
            if (getItemId(link?.href) !== card.dataset.boothManagerItemId) continue;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (rect.width < 80 || rect.height < 80 ||
                style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 ||
                !getBestImageUrl(element)) continue;
            visibleImages.add(element);
            const area = rect.width * rect.height;
            if (area > bestArea) {
                bestArea = area;
                best = element;
            }
        }
        // BOOTHは既存画像を残して同寸の画像をabsoluteで重ねる。
        // DOM順や面積ではなく、ポインター位置での実際の描画順を優先する。
        for (const element of hitElements) {
            if (visibleImages.has(element)) return element;
        }
        return best;
    }

    function createPreviewBox() {
        previewBox = document.createElement('div');
        previewBox.id = 'booth-manager-preview';
        previewBox.setAttribute('aria-hidden', 'true');
        previewImage = document.createElement('img');
        previewImage.alt = 'BOOTH Preview';
        previewInfo = document.createElement('div');
        previewInfo.className = 'booth-manager-preview-info';
        previewBox.append(previewImage, previewInfo);
        document.body.appendChild(previewBox);
        previewDebug('created', { connected: previewBox.isConnected });

        previewImage.addEventListener('load', () => {
            // カーソル離脱後にロードが完了しても再表示しない。
            if (!activePreviewSource || previewImage.src !== activePreviewUrl) return;
            resizePreview();
            previewBox.classList.add('visible');
            positionPreview();
            previewDebug('visible', {
                url: activePreviewUrl,
                naturalWidth: previewImage.naturalWidth,
                rect: previewBox.getBoundingClientRect().toJSON(),
                display: getComputedStyle(previewBox).display,
                position: getComputedStyle(previewBox).position,
                zIndex: getComputedStyle(previewBox).zIndex
            });
        });
        previewImage.addEventListener('error', () => {
            if (!activePreviewSource) return;
            console.warn('[BOOTH Preview] image load failed', activePreviewUrl);
            // 同じ画像上で pointermove ごとに再リクエストしない。
            previewBox.classList.remove('visible');
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') hidePreview();
        });
        window.addEventListener('resize', () => {
            resizePreview();
            positionPreview();
        });
        window.addEventListener('scroll', hidePreview, true);
        window.addEventListener('blur', hidePreview);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) hidePreview();
        });
    }

    function resizePreview() {
        if (!previewImage?.naturalWidth || !previewImage.naturalHeight) return;
        const target = loadSettings().previewSize;
        const nw = previewImage.naturalWidth;
        const nh = previewImage.naturalHeight;
        const scale = Math.min(target / Math.max(nw, nh),
            Math.max(1, window.innerWidth - 60) / nw,
            Math.max(1, window.innerHeight - 90) / nh);
        const width = Math.max(1, Math.floor(nw * scale));
        const height = Math.max(1, Math.floor(nh * scale));
        previewImage.style.width = width + 'px';
        previewImage.style.height = height + 'px';
        previewInfo.textContent = `表示 ${width} × ${height} px / 設定 ${target}px`;
    }

    function positionPreview() {
        if (!activePreviewCard || !previewBox.classList.contains('visible')) return;
        const rect = activePreviewSource.getBoundingClientRect();
        const box = previewBox.getBoundingClientRect();
        const margin = 12;
        let left = rect.right + 16;
        if (left + box.width > window.innerWidth - margin) left = rect.left - box.width - 16;
        if (left < margin) left = (window.innerWidth - box.width) / 2;
        previewBox.style.left = Math.round(Math.max(margin,
            Math.min(left, window.innerWidth - box.width - margin))) + 'px';
        previewBox.style.top = Math.round(Math.max(margin,
            Math.min(rect.top, window.innerHeight - box.height - margin))) + 'px';
    }

    function showPreview(image, card) {
        if (!loadSettings().previewEnabled) return;
        const url = getBestImageUrl(image);
        if (!url) return;
        if (activePreviewSource === image && activePreviewUrl === url) return;
        activePreviewSource = image;
        activePreviewCard = card;
        activePreviewUrl = url;
        previewBox.classList.remove('visible');
        previewDebug('loading', { itemId: card.dataset.boothManagerItemId, tag: image.tagName, url });
        // ページで実際に使用中のURLを使う。未検証のCDNパスへ書き換えない。
        if (previewImage.src !== url) previewImage.src = url;
        if (previewImage.complete && previewImage.naturalWidth) {
            resizePreview();
            previewBox.classList.add('visible');
            positionPreview();
        }
    }

    function hidePreview() {
        previewSourceObserver.disconnect();
        previewObservedCard = null;
        if (pointerRAF !== null) {
            cancelAnimationFrame(pointerRAF);
            pointerRAF = null;
        }
        activePreviewCard = null;
        activePreviewSource = null;
        activePreviewUrl = '';
        previewBox?.classList.remove('visible');
    }

    function handlePointerPosition() {
        pointerRAF = null;
        if (!loadSettings().previewEnabled) {
            hidePreview();
            return;
        }
        const elements = document.elementsFromPoint(pointerX, pointerY);
        // パネルなどの背後にあるカードはホバー対象にしない。
        const card = elements[0]?.closest('[data-booth-manager-item-id]');
        if (!card || card.offsetParent === null) {
            previewDebug('no-card', { x: pointerX, y: pointerY });
            hidePreview();
            return;
        }
        observePreviewCard(card);
        const image = findPrimaryImage(card, elements);
        if (!image) {
            previewDebug('no-thumbnail', { itemId: card.dataset.boothManagerItemId });
            // 切替中に一瞬すべての画像が非表示でも、次のDOM変更を待つ。
            activePreviewSource = null;
            activePreviewUrl = '';
            previewBox?.classList.remove('visible');
            return;
        }
        const rect = image.getBoundingClientRect();
        if (pointerX < rect.left || pointerX > rect.right || pointerY < rect.top || pointerY > rect.bottom) {
            hidePreview();
            return;
        }
        showPreview(image, card);
    }

    function setupPreviewEvents() {
        document.addEventListener('pointermove', event => {
            if (event.pointerType === 'touch') return;
            pointerX = event.clientX;
            pointerY = event.clientY;
            if (PREVIEW_DEBUG && !document.documentElement.hasAttribute('data-booth-preview-pointer-seen')) {
                document.documentElement.setAttribute('data-booth-preview-pointer-seen', 'true');
                console.debug('[BOOTH Preview] pointermove reached', { x: pointerX, y: pointerY, target: event.target });
            }
            schedulePreviewUpdate();
        }, true);
        // capture の pointerleave は子要素間の移動でも到達するので使わない。
        document.addEventListener('pointerout', event => {
            if (!event.relatedTarget) hidePreview();
        }, true);
        document.addEventListener('pointerdown', event => {
            if (!event.target.closest?.('#booth-manager-panel')) hidePreview();
        }, true);
    }


    // =========================================================
    // サイズ設定
    // =========================================================

    function setPreviewSize(value) {
        const settings =
            loadSettings();


        let size =
            Number(value);


        if (
            !Number.isFinite(
                size
            )
        ) {
            return;
        }


        size =
            clamp(
                Math.round(size),
                MIN_PREVIEW_SIZE,
                MAX_PREVIEW_SIZE
            );


        settings.previewSize =
            size;


        // 現在値が最大値を超えたら自動拡張
        if (
            size >
            settings.previewSliderMax
        ) {
            settings.previewSliderMax =
                size;
        }


        saveSettings(
            settings
        );


        updateSettingsUI();


        if (
            previewBox &&
            previewBox.classList
                .contains(
                    'visible'
                )
        ) {
            resizePreview();

            positionPreview();
        }
    }


    function setPreviewSliderMax(value) {
        const settings =
            loadSettings();


        let max =
            Number(value);


        if (
            !Number.isFinite(
                max
            )
        ) {
            return;
        }


        max =
            clamp(
                Math.round(max),
                MIN_PREVIEW_SIZE,
                MAX_PREVIEW_SIZE
            );


        settings.previewSliderMax =
            max;


        if (
            settings.previewSize >
            max
        ) {
            settings.previewSize =
                max;
        }


        saveSettings(
            settings
        );


        updateSettingsUI();


        if (
            previewBox &&
            previewBox.classList
                .contains(
                    'visible'
                )
        ) {
            resizePreview();

            positionPreview();
        }
    }


    // =========================================================
    // 設定UI同期
    // =========================================================

    function updateSettingsUI() {
        const settings =
            loadSettings();


        const enabled =
            byId(
                'booth-preview-enabled'
            );


        const range =
            byId(
                'booth-preview-range'
            );


        const size =
            byId(
                'booth-preview-size-input'
            );


        const max =
            byId(
                'booth-preview-max-input'
            );


        if (enabled) {
            enabled.checked =
                settings.previewEnabled;
        }


        if (range) {
            range.min =
                MIN_PREVIEW_SIZE;

            range.max =
                settings.previewSliderMax;

            range.value =
                settings.previewSize;
        }


        if (size) {
            size.min =
                MIN_PREVIEW_SIZE;

            size.max =
                MAX_PREVIEW_SIZE;

            size.value =
                settings.previewSize;
        }


        if (max) {
            max.min =
                MIN_PREVIEW_SIZE;

            max.max =
                MAX_PREVIEW_SIZE;

            max.value =
                settings.previewSliderMax;
        }
    }


    // =========================================================
    // フィルターUI
    // =========================================================

    function updateFilterButtons() {
        document
            .querySelectorAll(
                '#booth-manager-panel [data-filter]'
            )
            .forEach(
                function (button) {

                    button.classList.toggle(
                        'active',

                        button.dataset
                            .filter ===
                            currentFilter
                    );
                }
            );
    }


    // =========================================================
    // パネル
    // =========================================================

    function createPanel() {
        const panel =
            document.createElement(
                'div'
            );


        panel.id =
            'booth-manager-panel';


        panel.innerHTML = `

            <div class="booth-panel-header">

                <strong>
                    👗 BOOTH 衣装チェック
                </strong>

                <button
                    id="booth-panel-collapse"
                    type="button"
                >
                    －
                </button>

            </div>


            <div id="booth-panel-body">

                <div class="booth-stats">

                    <span>
                        ⭐
                        <strong id="booth-favorite-count">
                            0
                        </strong>
                    </span>

                    <span>
                        🙈
                        <strong id="booth-hidden-count">
                            0
                        </strong>
                    </span>

                </div>


                <div class="booth-filter-row">

                    <button
                        type="button"
                        data-filter="normal"
                    >
                        通常
                    </button>

                    <button
                        type="button"
                        data-filter="favorite"
                    >
                        ⭐のみ
                    </button>

                    <button
                        type="button"
                        data-filter="all"
                    >
                        全表示
                    </button>

                </div>


                <details
                    class="booth-settings"
                    open
                >

                    <summary>
                        ⚙ 設定
                    </summary>


                    <label class="booth-check-row">

                        <input
                            id="booth-preview-enabled"
                            type="checkbox"
                        >

                        <span>
                            画像ポップアップ
                        </span>

                    </label>


                    <div class="booth-label">
                        プレビュー長辺
                    </div>


                    <div class="booth-size-row">

                        <input
                            id="booth-preview-range"
                            type="range"
                            step="25"
                        >

                        <input
                            id="booth-preview-size-input"
                            type="number"
                            step="25"
                        >

                        <span>
                            px
                        </span>

                    </div>


                    <div class="booth-label">
                        スライダー最大値
                    </div>


                    <div class="booth-max-row">

                        <input
                            id="booth-preview-max-input"
                            type="number"
                            step="100"
                        >

                        <span>
                            px
                        </span>

                    </div>


                    <div class="booth-hint">
                        250～5000pxまで手入力できます。
                    </div>

                    <div class="booth-hint">
                        商品画像の上にマウスを置くと、
                        商品の横へ独立したプレビューを表示します。
                    </div>

                </details>


                <details class="booth-management">

                    <summary>
                        管理
                    </summary>

                    <button
                        id="booth-clear-favorites"
                        type="button"
                    >
                        ☆ 気になるを全解除
                    </button>

                    <button
                        id="booth-clear-hidden"
                        type="button"
                        class="danger"
                    >
                        ↩ 非表示を全解除
                    </button>

                </details>

            </div>
        `;


        document.body.appendChild(
            panel
        );


        // -----------------------------------------------------
        // フィルター
        // -----------------------------------------------------

        panel
            .querySelectorAll(
                '[data-filter]'
            )
            .forEach(
                function (button) {

                    button.addEventListener(
                        'click',
                        function () {

                            currentFilter =
                                button.dataset
                                    .filter;


                            hidePreview();


                            updateFilterButtons();


                            refreshCards();


                            if (
                                currentFilter ===
                                'all'
                            ) {
                                setTimeout(
                                    scanProducts,
                                    100
                                );
                            }
                        }
                    );
                }
            );


        // -----------------------------------------------------
        // パネル開閉
        // -----------------------------------------------------

        byId(
            'booth-panel-collapse'
        )
            .addEventListener(
                'click',
                function () {

                    const collapsed =
                        panel.classList
                            .toggle(
                                'collapsed'
                            );


                    this.textContent =
                        collapsed
                            ? '＋'
                            : '－';


                    localStorage.setItem(
                        PANEL_COLLAPSED_KEY,

                        collapsed
                            ? '1'
                            : '0'
                    );
                }
            );


        // -----------------------------------------------------
        // Popup ON/OFF
        // -----------------------------------------------------

        byId(
            'booth-preview-enabled'
        )
            .addEventListener(
                'change',
                function () {

                    const settings =
                        loadSettings();


                    settings.previewEnabled =
                        this.checked;


                    saveSettings(
                        settings
                    );


                    if (!this.checked) {
                        hidePreview();
                    }
                }
            );


        // -----------------------------------------------------
        // Slider
        // -----------------------------------------------------

        byId(
            'booth-preview-range'
        )
            .addEventListener(
                'input',
                function () {

                    setPreviewSize(
                        this.value
                    );
                }
            );


        // -----------------------------------------------------
        // サイズ直接入力
        // -----------------------------------------------------

        byId(
            'booth-preview-size-input'
        )
            .addEventListener(
                'change',
                function () {

                    setPreviewSize(
                        this.value
                    );
                }
            );


        // -----------------------------------------------------
        // Slider最大値入力
        // -----------------------------------------------------

        byId(
            'booth-preview-max-input'
        )
            .addEventListener(
                'change',
                function () {

                    setPreviewSliderMax(
                        this.value
                    );
                }
            );


        // -----------------------------------------------------
        // Enter確定
        // -----------------------------------------------------

        panel
            .querySelectorAll(
                'input[type="number"]'
            )
            .forEach(
                function (input) {

                    input.addEventListener(
                        'keydown',
                        function (event) {

                            if (
                                event.key ===
                                'Enter'
                            ) {
                                this.blur();
                            }
                        }
                    );
                }
            );


        // -----------------------------------------------------
        // 気になる全解除
        // -----------------------------------------------------

        byId(
            'booth-clear-favorites'
        )
            .addEventListener(
                'click',
                function () {

                    const count =
                        Object.keys(
                            loadData(
                                FAVORITE_KEY
                            )
                        ).length;


                    if (!count) {
                        alert(
                            '気になる商品はありません。'
                        );

                        return;
                    }


                    if (
                        !confirm(
                            '気になる ' +
                            count +
                            ' 件をすべて解除しますか？'
                        )
                    ) {
                        return;
                    }


                    localStorage.removeItem(
                        FAVORITE_KEY
                    );


                    document
                        .querySelectorAll(
                            '.booth-manager-actions'
                        )
                        .forEach(
                            function (area) {

                                delete area
                                    .dataset
                                    .state;
                            }
                        );


                    refreshCards();
                }
            );


        // -----------------------------------------------------
        // 非表示全解除
        // -----------------------------------------------------

        byId(
            'booth-clear-hidden'
        )
            .addEventListener(
                'click',
                function () {

                    const count =
                        Object.keys(
                            loadData(
                                HIDDEN_KEY
                            )
                        ).length;


                    if (!count) {
                        alert(
                            '非表示商品はありません。'
                        );

                        return;
                    }


                    if (
                        !confirm(
                            '非表示 ' +
                            count +
                            ' 件をすべて解除しますか？'
                        )
                    ) {
                        return;
                    }


                    localStorage.removeItem(
                        HIDDEN_KEY
                    );


                    document
                        .querySelectorAll(
                            '.booth-manager-actions'
                        )
                        .forEach(
                            function (area) {

                                delete area
                                    .dataset
                                    .state;
                            }
                        );


                    refreshCards();
                }
            );


        // -----------------------------------------------------
        // 初期状態
        // -----------------------------------------------------

        updateSettingsUI();

        updateFilterButtons();

        updatePanel();


        if (
            localStorage.getItem(
                PANEL_COLLAPSED_KEY
            ) ===
            '1'
        ) {
            panel.classList.add(
                'collapsed'
            );


            byId(
                'booth-panel-collapse'
            ).textContent =
                '＋';
        }
    }


    // =========================================================
    // 件数更新
    // =========================================================

    function updatePanel() {
        const favorite =
            byId(
                'booth-favorite-count'
            );


        const hidden =
            byId(
                'booth-hidden-count'
            );


        if (favorite) {
            favorite.textContent =
                Object.keys(
                    loadData(
                        FAVORITE_KEY
                    )
                ).length;
        }


        if (hidden) {
            hidden.textContent =
                Object.keys(
                    loadData(
                        HIDDEN_KEY
                    )
                ).length;
        }
    }


    // =========================================================
    // CSS
    // =========================================================

    function addCSS() {
        const style =
            document.createElement(
                'style'
            );


        style.id =
            'booth-manager-style';


        style.textContent = `

            /* =============================================
               商品操作
            ============================================= */

            .booth-manager-actions {

                display:
                    grid !important;

                grid-template-columns:
                    1fr 1fr !important;

                gap:
                    5px !important;

                width:
                    100% !important;

                box-sizing:
                    border-box !important;

                margin:
                    5px 0 !important;
            }


            .booth-manager-actions[data-state="hidden"] {

                grid-template-columns:
                    1fr !important;
            }


            .booth-manager-button {

                width:
                    100% !important;

                min-width:
                    0 !important;

                border:
                    1px solid
                    rgba(
                        255,
                        255,
                        255,
                        0.9
                    )
                    !important;

                border-radius:
                    6px !important;

                padding:
                    5px 3px !important;

                font-size:
                    10.5px !important;

                font-weight:
                    700 !important;

                cursor:
                    pointer !important;

                color:
                    white !important;
            }


            .booth-manager-button.favorite {

                background:
                    #3f4147 !important;
            }


            .booth-manager-button.favorite.active {

                background:
                    #e8b32e !important;

                color:
                    #222 !important;
            }


            .booth-manager-button.hide {

                background:
                    #bd4b56 !important;
            }


            .booth-manager-button.restore {

                background:
                    #4c9a7d !important;
            }


            .booth-manager-button:hover {

                filter:
                    brightness(
                        1.13
                    )
                    !important;
            }


            /* =============================================
               気になる
            ============================================= */

            .booth-manager-favorite-card {

                outline:
                    2px solid
                    #e8b32e
                    !important;

                outline-offset:
                    -2px
                    !important;
            }


            /* =============================================
               非表示商品を全表示した場合
            ============================================= */

            .booth-manager-hidden-card img {

                opacity:
                    0.28
                    !important;

                filter:
                    grayscale(
                        0.65
                    )
                    !important;
            }


            /* =============================================
               ★ 独立ポップアップ
            ============================================= */

            #booth-manager-preview {

                position:
                    fixed !important;

                z-index:
                    2147483646
                    !important;

                display:
                    none;

                pointer-events:
                    none !important;

                padding:
                    7px !important;

                box-sizing:
                    border-box !important;

                background:
                    rgba(
                        18,
                        18,
                        22,
                        0.985
                    )
                    !important;

                border:
                    2px solid
                    rgba(
                        255,
                        255,
                        255,
                        0.72
                    )
                    !important;

                border-radius:
                    10px !important;

                box-shadow:
                    0 12px 45px
                    rgba(
                        0,
                        0,
                        0,
                        0.7
                    )
                    !important;
            }


            #booth-manager-preview.visible {

                display:
                    block !important;
            }


            #booth-manager-preview img {

                display:
                    block !important;

                max-width:
                    none !important;

                max-height:
                    none !important;

                min-width:
                    0 !important;

                min-height:
                    0 !important;

                opacity:
                    1 !important;

                filter:
                    none !important;

                object-fit:
                    contain !important;

                border-radius:
                    6px !important;
            }


            .booth-manager-preview-info {

                padding:
                    5px 3px 0 !important;

                text-align:
                    center !important;

                color:
                    #bbbbbb !important;

                font-size:
                    10px !important;

                font-family:
                    -apple-system,
                    BlinkMacSystemFont,
                    "Segoe UI",
                    sans-serif
                    !important;
            }


            /* =============================================
               右下パネル
            ============================================= */

            #booth-manager-panel {

                position:
                    fixed !important;

                right:
                    18px !important;

                bottom:
                    18px !important;

                z-index:
                    2147483647
                    !important;

                width:
                    275px !important;

                box-sizing:
                    border-box !important;

                padding:
                    12px !important;

                border-radius:
                    12px !important;

                background:
                    rgba(
                        28,
                        29,
                        34,
                        0.97
                    )
                    !important;

                color:
                    white !important;

                box-shadow:
                    0 5px 25px
                    rgba(
                        0,
                        0,
                        0,
                        0.4
                    )
                    !important;

                font-family:
                    -apple-system,
                    BlinkMacSystemFont,
                    "Segoe UI",
                    sans-serif
                    !important;

                font-size:
                    12px !important;
            }


            .booth-panel-header {

                display:
                    flex !important;

                align-items:
                    center !important;

                justify-content:
                    space-between !important;
            }


            #booth-panel-collapse {

                width:
                    28px !important;

                height:
                    28px !important;

                border:
                    0 !important;

                border-radius:
                    6px !important;

                background:
                    #484a51 !important;

                color:
                    white !important;

                cursor:
                    pointer !important;
            }


            #booth-manager-panel.collapsed {

                width:
                    205px !important;
            }


            #booth-manager-panel.collapsed
            #booth-panel-body {

                display:
                    none !important;
            }


            .booth-stats {

                display:
                    flex !important;

                justify-content:
                    space-between !important;

                margin-top:
                    9px !important;

                padding:
                    7px 9px !important;

                background:
                    rgba(
                        255,
                        255,
                        255,
                        0.07
                    )
                    !important;

                border-radius:
                    7px !important;
            }


            .booth-filter-row {

                display:
                    grid !important;

                grid-template-columns:
                    repeat(
                        3,
                        1fr
                    )
                    !important;

                gap:
                    5px !important;

                margin-top:
                    8px !important;
            }


            .booth-filter-row button,
            .booth-management button {

                border:
                    0 !important;

                border-radius:
                    6px !important;

                padding:
                    7px 5px !important;

                background:
                    #4a4c54 !important;

                color:
                    white !important;

                font-size:
                    11px !important;

                cursor:
                    pointer !important;
            }


            .booth-filter-row button.active {

                background:
                    white !important;

                color:
                    #222 !important;

                font-weight:
                    bold !important;
            }


            /* =============================================
               設定
            ============================================= */

            .booth-settings {

                margin-top:
                    9px !important;

                padding:
                    8px !important;

                background:
                    rgba(
                        255,
                        255,
                        255,
                        0.05
                    )
                    !important;

                border-radius:
                    7px !important;
            }


            .booth-settings summary,
            .booth-management summary {

                cursor:
                    pointer !important;

                user-select:
                    none !important;

                font-weight:
                    600 !important;
            }


            .booth-check-row {

                display:
                    flex !important;

                align-items:
                    center !important;

                gap:
                    7px !important;

                margin-top:
                    10px !important;
            }


            .booth-label {

                margin-top:
                    11px !important;

                margin-bottom:
                    5px !important;

                color:
                    #dddddd !important;

                font-size:
                    11px !important;
            }


            .booth-size-row {

                display:
                    grid !important;

                grid-template-columns:
                    minmax(
                        0,
                        1fr
                    )
                    68px
                    18px
                    !important;

                gap:
                    5px !important;

                align-items:
                    center !important;
            }


            .booth-max-row {

                display:
                    grid !important;

                grid-template-columns:
                    82px
                    18px
                    !important;

                gap:
                    5px !important;

                align-items:
                    center !important;
            }


            #booth-preview-range {

                width:
                    100% !important;

                min-width:
                    0 !important;
            }


            .booth-settings
            input[type="number"] {

                width:
                    100% !important;

                box-sizing:
                    border-box !important;

                padding:
                    4px 5px !important;

                border:
                    1px solid
                    #666 !important;

                border-radius:
                    5px !important;

                background:
                    #24262b !important;

                color:
                    white !important;

                font-size:
                    11px !important;
            }


            .booth-hint {

                margin-top:
                    6px !important;

                color:
                    #999 !important;

                font-size:
                    9.5px !important;

                line-height:
                    1.4 !important;
            }


            .booth-management {

                margin-top:
                    9px !important;
            }


            .booth-management button {

                display:
                    block !important;

                width:
                    100% !important;

                margin-top:
                    6px !important;
            }


            .booth-management
            button.danger {

                background:
                    #963f48 !important;
            }

        `;


        document.head.appendChild(
            style
        );
    }


    // =========================================================
    // BOOTH動的読み込み
    // =========================================================

    function startObserver() {
        observer =
            new MutationObserver(
                function (mutations) {

                    let needsScan =
                        false;


                    for (
                        const mutation
                        of mutations
                    ) {
                        for (
                            const node
                            of mutation.addedNodes
                        ) {
                            if (
                                !(
                                    node instanceof
                                    Element
                                )
                            ) {
                                continue;
                            }


                            if (
                                node.closest?.(
                                    '#booth-manager-panel'
                                ) ||

                                node.closest?.(
                                    '#booth-manager-preview'
                                ) ||

                                node.closest?.(
                                    '.booth-manager-actions'
                                )
                            ) {
                                continue;
                            }


                            if (
                                node.matches?.(
                                    'a[href*="/items/"]'
                                ) ||

                                node.querySelector?.(
                                    'a[href*="/items/"]'
                                )
                            ) {
                                needsScan =
                                    true;

                                break;
                            }
                        }


                        if (needsScan) {
                            break;
                        }
                    }


                    if (!needsScan) {
                        return;
                    }


                    clearTimeout(
                        scanTimer
                    );


                    scanTimer =
                        setTimeout(
                            scanProducts,
                            250
                        );
                }
            );


        observer.observe(
            document.body,
            {
                childList:
                    true,

                subtree:
                    true
            }
        );
    }


    // =========================================================
    // 古いUIを掃除
    // =========================================================

    function cleanupOldUI() {
        document
            .querySelectorAll(
                '.booth-manager-actions'
            )
            .forEach(
                element =>
                    element.remove()
            );


        document
            .querySelectorAll(
                '[data-booth-manager-item-id]'
            )
            .forEach(
                function (element) {

                    element.removeAttribute(
                        'data-booth-manager-item-id'
                    );


                    element.removeAttribute(
                        'data-booth-manager-title'
                    );


                    element.classList.remove(
                        'booth-manager-favorite-card',
                        'booth-manager-hidden-card'
                    );


                    element.style.removeProperty(
                        'display'
                    );
                }
            );


        document
            .querySelectorAll(
                '[data-booth-manager-layout-item-id]'
            )
            .forEach(
                function (element) {

                    element.removeAttribute(
                        'data-booth-manager-layout-item-id'
                    );


                    element.style.removeProperty(
                        'display'
                    );
                }
            );


        byId(
            'booth-manager-panel'
        )
            ?.remove();


        byId(
            'booth-manager-preview'
        )
            ?.remove();


        byId(
            'booth-manager-style'
        )
            ?.remove();
    }


    // =========================================================
    // 初期化
    // =========================================================

    function init() {
        cleanupOldUI();


        addCSS();


        createPreviewBox();


        createPanel();


        setupPreviewEvents();


        setTimeout(
            scanProducts,
            350
        );


        setTimeout(
            scanProducts,
            1000
        );


        setTimeout(
            scanProducts,
            2200
        );


        startObserver();


        console.log(
            '[BOOTH Manager] v3.4.3 ready'
        );
    }


    init();

})();
