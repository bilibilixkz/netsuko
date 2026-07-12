(function () {
    'use strict';

    var theme = window.NetsukoTheme = window.NetsukoTheme || {};
    var config = window.NetsukoPjaxConfig || {};
    var containerSelector = config.container || '#netsuko-pjax-container';
    var activeRequest = null;
    var loadedExternalScripts = {};
    var transitionTimer = null;
    var readingProgressFrame = null;
    var motionObserver = null;
    var fancyboxAssetsPromise = null;
    var highlightAssetsPromise = null;
    var katexAssetsPromise = null;
    var currentPjaxHref = window.location.href;
    var postLightboxSelector = '.post-content a.netsuko-image-lightbox[data-fancybox]';

    function $(selector, root) {
        return (root || document).querySelector(selector);
    }

    function $all(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function samePageUrl(left, right) {
        return left.origin === right.origin &&
            left.pathname.replace(/\/+$/, '') === right.pathname.replace(/\/+$/, '') &&
            left.search === right.search;
    }

    function normalizeNavigationPath(pathname) {
        var path = pathname.replace(/\/+$/, '') || '/';
        return path === '/index.php' ? '/' : path;
    }

    function sameNavigationUrl(left, right) {
        return left.origin === right.origin &&
            normalizeNavigationPath(left.pathname) === normalizeNavigationPath(right.pathname);
    }

    function getExcludeText(url) {
        return url.pathname + url.search + url.hash;
    }

    function isExcluded(url) {
        var excludes = Array.isArray(config.excludes) ? config.excludes : [];
        var text = getExcludeText(url);

        return excludes.some(function (item) {
            return item && text.indexOf(item) !== -1;
        });
    }

    function shouldHandleLink(link, event) {
        if (!config.enabled || !link || event.defaultPrevented) {
            return false;
        }

        if (event.target.closest('.fancybox__container, [data-fancybox-close], [data-fancybox-button], [data-panzoom-action], .f-button')) {
            return false;
        }

        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return false;
        }

        if (link.target && link.target.toLowerCase() !== '_self') {
            return false;
        }

        if (link.hasAttribute('download') || link.closest('[data-no-pjax]')) {
            return false;
        }

        var rawHref = link.getAttribute('href') || '';
        if (!rawHref || rawHref.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(rawHref)) {
            return false;
        }

        if (link.hasAttribute('data-fancybox') || link.classList.contains('netsuko-image-lightbox') || isImageHref(rawHref) || isImageHref(link.href)) {
            return false;
        }

        var url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || isExcluded(url)) {
            return false;
        }

        if (samePageUrl(url, new URL(window.location.href)) && url.hash) {
            return false;
        }

        return true;
    }

    function setLoading(isLoading) {
        ensureProgressIndicators();
        window.clearTimeout(transitionTimer);

        document.documentElement.classList.toggle('netsuko-pjax-loading', isLoading);
        document.body.classList.toggle('netsuko-pjax-loading', isLoading);

        if (isLoading) {
            document.documentElement.classList.remove('netsuko-pjax-complete', 'netsuko-page-enter');
            document.documentElement.dataset.netsukoPjaxState = 'loading';
            return;
        }

        document.documentElement.classList.add('netsuko-pjax-complete');
        document.documentElement.dataset.netsukoPjaxState = 'ready';
        transitionTimer = window.setTimeout(function () {
            document.documentElement.classList.remove('netsuko-pjax-complete');
        }, 520);
    }

    function ensureProgressIndicators() {
        if (!$('#netsuko-pjax-progress')) {
            var pjaxProgress = document.createElement('div');
            pjaxProgress.id = 'netsuko-pjax-progress';
            pjaxProgress.setAttribute('aria-hidden', 'true');
            document.body.appendChild(pjaxProgress);
        }

        if (!$('#netsuko-reading-progress')) {
            var readingProgress = document.createElement('div');
            var readingProgressBar = document.createElement('span');
            readingProgress.id = 'netsuko-reading-progress';
            readingProgress.setAttribute('aria-hidden', 'true');
            readingProgress.appendChild(readingProgressBar);
            document.body.appendChild(readingProgress);
        }
    }

    function updateReadingProgress() {
        var bar = $('#netsuko-reading-progress span');
        if (!bar) {
            return;
        }

        var doc = document.documentElement;
        var max = Math.max(0, doc.scrollHeight - window.innerHeight);
        var progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        var isActive = max > 160;

        document.documentElement.classList.toggle('netsuko-reading-active', isActive);
        bar.style.transform = 'scaleX(' + progress.toFixed(4) + ')';
    }

    function scheduleReadingProgress() {
        if (readingProgressFrame) {
            window.cancelAnimationFrame(readingProgressFrame);
        }

        readingProgressFrame = window.requestAnimationFrame(function () {
            readingProgressFrame = null;
            updateReadingProgress();
        });
    }

    function restartPageEnter() {
        document.documentElement.classList.remove('netsuko-page-enter');
        void document.documentElement.offsetWidth;
        document.documentElement.classList.add('netsuko-page-enter');
    }

    function isInViewport(node) {
        var rect = node.getBoundingClientRect();
        return rect.bottom >= 0 && rect.top <= (window.innerHeight || document.documentElement.clientHeight);
    }

    function revealVisibleMotionTargets(targets) {
        targets.forEach(function (node) {
            if (!node.classList.contains('is-visible') && isInViewport(node)) {
                node.classList.add('is-visible');
            }
        });
    }

    function prepareMotionTargets(root) {
        var scope = root || document;
        var targets = $all([
            '#home-banner',
            '#main > div > article',
            '#main > aside',
            '#respond',
            '.pagination'
        ].join(','), scope);

        if (motionObserver) {
            motionObserver.disconnect();
        }

        motionObserver = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) {
                    return;
                }

                entry.target.classList.add('is-visible');
                motionObserver.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0 }) : null;

        targets.forEach(function (node, index) {
            node.dataset.netsukoMotion = 'true';
            node.style.setProperty('--netsuko-motion-delay', Math.min(index * 55, 220) + 'ms');

            if (isInViewport(node)) {
                node.classList.add('is-visible');
            }

            if (motionObserver) {
                if (!node.classList.contains('is-visible')) {
                    motionObserver.observe(node);
                }
            } else {
                node.classList.add('is-visible');
            }
        });

        window.setTimeout(function () {
            revealVisibleMotionTargets(targets);
        }, 120);
    }

    function initMotionEvents() {
        if (document.documentElement.dataset.netsukoMotionEventsReady === 'true') {
            return;
        }

        document.documentElement.dataset.netsukoMotionEventsReady = 'true';
        window.addEventListener('scroll', scheduleReadingProgress, { passive: true });
        window.addEventListener('resize', scheduleReadingProgress);
    }

    function withAssetVersion(url) {
        if (!url || !config.assetVersion || /[?&]v=/.test(url)) {
            return url;
        }

        return url + (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(config.assetVersion);
    }

    function ensureStylesheet(url) {
        if (!url) {
            return Promise.resolve();
        }

        var href = withAssetVersion(url);
        var exists = $all('link[rel="stylesheet"]').some(function (link) {
            return link.href === href || link.href === url;
        });

        if (exists) {
            return Promise.resolve();
        }

        return new Promise(function (resolve) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.dataset.netsukoAsset = 'true';
            link.onload = resolve;
            link.onerror = resolve;
            document.head.appendChild(link);
        });
    }

    function ensureScript(url, test) {
        if (!url || (typeof test === 'function' && test())) {
            return Promise.resolve();
        }

        var src = withAssetVersion(url);
        var existing = $all('script[src]').filter(function (script) {
            return script.src === src || script.src === url;
        })[0];

        if (existing) {
            return new Promise(function (resolve) {
                if (typeof test === 'function' && test()) {
                    resolve();
                    return;
                }

                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', resolve, { once: true });
                window.setTimeout(resolve, 1200);
            });
        }

        return new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.netsukoAsset = 'true';
            script.onload = resolve;
            script.onerror = resolve;
            document.body.appendChild(script);
        });
    }

    function ensureFancyboxAssets() {
        if (window.Fancybox) {
            return Promise.resolve();
        }

        if (fancyboxAssetsPromise) {
            return fancyboxAssetsPromise;
        }

        var assets = config.fancybox || {};
        ensureStylesheet(assets.css);
        fancyboxAssetsPromise = ensureScript(assets.js, function () {
            return !!window.Fancybox;
        }).then(function () {
            return window.Fancybox || null;
        });

        return fancyboxAssetsPromise;
    }

    function ensureHighlightAssets() {
        var content = config.content || {};
        var assets = content.highlight || {};
        if (!assets.enabled) {
            return Promise.resolve(null);
        }

        if (window.hljs) {
            return Promise.resolve(window.hljs);
        }

        if (highlightAssetsPromise) {
            return highlightAssetsPromise;
        }

        highlightAssetsPromise = ensureScript(assets.js, function () {
            return !!window.hljs;
        }).then(function () {
            return window.hljs || null;
        });

        return highlightAssetsPromise;
    }

    function ensureKatexAssets() {
        var content = config.content || {};
        var assets = content.latex || {};

        if (window.katex && window.renderMathInElement) {
            return Promise.resolve(window.katex);
        }

        if (katexAssetsPromise) {
            return katexAssetsPromise;
        }

        katexAssetsPromise = ensureStylesheet(assets.css)
            .then(function () {
                return ensureScript(assets.js, function () {
                    return !!window.katex;
                });
            })
            .then(function () {
                return ensureScript(assets.autoRenderJs, function () {
                    return !!window.renderMathInElement;
                });
            })
            .then(function () {
                return window.katex || null;
            });

        return katexAssetsPromise;
    }

    function imageUrlFromElement(image) {
        return image.currentSrc || image.getAttribute('src') || image.src || '';
    }

    function isImageHref(href) {
        return /^data:image\//i.test(href) ||
            /\.(?:avif|gif|jpe?g|png|webp|bmp|svg)(?:[?#].*)?$/i.test(href);
    }

    function imageCaption(image) {
        var figureCaption = image.closest('figure') ? $('figcaption', image.closest('figure')) : null;
        return image.getAttribute('data-caption') ||
            image.getAttribute('alt') ||
            image.getAttribute('title') ||
            (figureCaption ? figureCaption.textContent.trim() : '');
    }

    function preparePostLightbox(root) {
        var scope = root || document;
        var images = $all('.post-content img', scope);
        var prepared = 0;

        images.forEach(function (image) {
            if (image.dataset.netsukoLightboxReady === 'true' || image.closest('[data-no-lightbox]')) {
                return;
            }

            var href = imageUrlFromElement(image);
            if (!href) {
                return;
            }

            var mediaNode = image.parentElement && image.parentElement.tagName.toLowerCase() === 'picture'
                ? image.parentElement
                : image;
            var parentNode = mediaNode.parentNode;
            var link = parentNode && parentNode.tagName && parentNode.tagName.toLowerCase() === 'a'
                ? parentNode
                : null;

            if (link && !isImageHref(link.href) && !link.hasAttribute('data-fancybox')) {
                return;
            }

            if (!link) {
                link = document.createElement('a');
                link.href = href;
                parentNode.insertBefore(link, mediaNode);
                link.appendChild(mediaNode);
            }

            link.href = link.href || href;
            link.dataset.fancybox = link.dataset.fancybox || 'post-images';
            link.dataset.noPjax = 'true';
            link.dataset.caption = link.dataset.caption || imageCaption(image);
            link.classList.add('netsuko-image-lightbox');
            link.setAttribute('aria-label', link.dataset.caption || image.getAttribute('alt') || 'View full-size image');
            image.dataset.netsukoLightboxReady = 'true';
            prepared++;
        });

        return prepared;
    }

    theme.initPostLightbox = function (root) {
        if (!preparePostLightbox(root || document)) {
            return;
        }

        ensureFancyboxAssets().then(function () {
            if (!window.Fancybox || typeof window.Fancybox.bind !== 'function') {
                return;
            }

            if (typeof window.Fancybox.unbind === 'function') {
                window.Fancybox.unbind(postLightboxSelector);
            }

            window.Fancybox.bind(postLightboxSelector, {
                contentClick: 'toggleZoom',
                backdropClick: 'close',
                Toolbar: {
                    display: {
                        left: ['infobar'],
                        middle: ['zoomIn', 'zoomOut', 'toggle1to1'],
                        right: ['download', 'close']
                    }
                }
            });
        });
    };

    theme.initLazyLoad = function (root) {
        var content = config.content || {};
        if (!content.lazyLoad) {
            return;
        }

        $all('.post-content img, .post-content iframe', root || document).forEach(function (media) {
            if (media.closest('[data-no-lazy]')) {
                return;
            }

            if (!media.hasAttribute('loading')) {
                media.setAttribute('loading', 'lazy');
            }

            if (media.tagName && media.tagName.toLowerCase() === 'img' && !media.hasAttribute('decoding')) {
                media.setAttribute('decoding', 'async');
            }

            media.classList.add('netsuko-lazy-media');

            if (media.complete || media.tagName.toLowerCase() === 'iframe') {
                media.classList.add('is-loaded');
                media.classList.remove('is-loading');
                return;
            }

            if (media.dataset.netsukoLazyReady === 'true') {
                return;
            }

            media.dataset.netsukoLazyReady = 'true';
            media.classList.add('is-loading');
            media.addEventListener('load', function () {
                media.classList.add('is-loaded');
                media.classList.remove('is-loading');
            }, { once: true });
            media.addEventListener('error', function () {
                media.classList.add('is-loaded');
                media.classList.remove('is-loading');
            }, { once: true });
        });
    };

    function copyTextFallback(text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();

        var ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (error) {
            ok = false;
        }

        document.body.removeChild(textarea);
        return ok;
    }

    function addCodeCopyButton(wrapper, code) {
        if (wrapper.dataset.netsukoCodeCopyReady === 'true') {
            return;
        }

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'netsuko-code-copy';
        button.textContent = '复制';
        button.setAttribute('aria-label', '复制代码');

        button.addEventListener('click', function () {
            var text = code.textContent || '';
            var done = function (ok) {
                button.textContent = ok ? '已复制' : '失败';
                window.setTimeout(function () {
                    button.textContent = '复制';
                }, 1400);
            };

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () {
                    done(true);
                }).catch(function () {
                    done(false);
                });
                return;
            }

            done(copyTextFallback(text));
        });

        wrapper.dataset.netsukoCodeCopyReady = 'true';
        wrapper.appendChild(button);
    }

    theme.initCodeHighlight = function (root) {
        var content = config.content || {};
        var assets = content.highlight || {};
        if (!assets.enabled) {
            return;
        }

        var blocks = $all('.post-content pre code', root || document);
        if (!blocks.length) {
            return;
        }

        ensureHighlightAssets().then(function (hljs) {
            blocks.forEach(function (code) {
                var pre = code.closest('pre');
                if (!pre) {
                    return;
                }

                pre.classList.add('netsuko-code-block');

                if (hljs && code.dataset.netsukoHighlighted !== 'true') {
                    try {
                        hljs.highlightElement(code);
                        code.dataset.netsukoHighlighted = 'true';
                    } catch (error) {
                        code.dataset.netsukoHighlighted = 'failed';
                    }
                }

                addCodeCopyButton(pre, code);
            });
        });
    };

    theme.initLatex = function (root) {
        var scope = root || document;
        var targets = $all('.post-content[data-netsuko-latex="on"]', scope);
        if (!targets.length && scope.matches && scope.matches('.post-content[data-netsuko-latex="on"]')) {
            targets = [scope];
        }

        if (!targets.length) {
            return;
        }

        ensureKatexAssets().then(function () {
            if (!window.renderMathInElement) {
                return;
            }

            targets.forEach(function (target) {
                if (target.dataset.netsukoLatexReady === 'true') {
                    return;
                }

                window.renderMathInElement(target, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '\\[', right: '\\]', display: true },
                        { left: '\\(', right: '\\)', display: false },
                        { left: '$', right: '$', display: false }
                    ],
                    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
                    throwOnError: false
                });
                target.dataset.netsukoLatexReady = 'true';
            });
        });
    };

    function closeDrawer() {
        var drawer = $('#mobile-drawer');
        var overlay = $('#drawer-overlay');
        var panel = $('#drawer-panel');
        if (!drawer || !overlay || !panel) {
            return;
        }

        overlay.classList.add('opacity-0');
        panel.classList.add('translate-x-full');
        document.body.style.overflow = '';
        window.setTimeout(function () {
            drawer.classList.add('hidden');
        }, 300);
    }

    theme.initMobileDrawer = function () {
        var drawer = $('#mobile-drawer');
        var overlay = $('#drawer-overlay');
        var panel = $('#drawer-panel');
        var openBtn = $('#mobile-menu-open');
        var closeBtn = $('#mobile-menu-close');
        if (!drawer || !overlay || !panel || !openBtn || !closeBtn) {
            return;
        }

        if (openBtn.dataset.netsukoDrawerReady === 'true') {
            return;
        }

        openBtn.dataset.netsukoDrawerReady = 'true';
        closeBtn.dataset.netsukoDrawerReady = 'true';
        overlay.dataset.netsukoDrawerReady = 'true';

        openBtn.addEventListener('click', function () {
            drawer.classList.remove('hidden');
            void drawer.offsetWidth;
            overlay.classList.remove('opacity-0');
            panel.classList.remove('translate-x-full');
            document.body.style.overflow = 'hidden';
        });
        closeBtn.addEventListener('click', closeDrawer);
        overlay.addEventListener('click', closeDrawer);
    };

    theme.initBackToTop = function () {
        var button = $('#back-to-top');
        if (!button || button.dataset.netsukoBackTopReady === 'true') {
            return;
        }

        var update = function () {
            if (window.scrollY > 400) {
                button.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-5');
                button.classList.add('opacity-100', 'pointer-events-auto', 'translate-y-0');
            } else {
                button.classList.add('opacity-0', 'pointer-events-none', 'translate-y-5');
                button.classList.remove('opacity-100', 'pointer-events-auto', 'translate-y-0');
            }
        };

        button.dataset.netsukoBackTopReady = 'true';
        window.addEventListener('scroll', update, { passive: true });
        button.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        update();
    };

    theme.initTurnstile = function (root) {
        if (!window.turnstile || typeof window.turnstile.render !== 'function') {
            return;
        }

        $all('.cf-turnstile', root || document).forEach(function (node) {
            if (node.dataset.netsukoTurnstileReady === 'true') {
                return;
            }

            try {
                window.turnstile.render(node);
                node.dataset.netsukoTurnstileReady = 'true';
            } catch (error) {
                // Turnstile may already be rendered by its own async loader.
            }
        });
    };

    function runLifecycle(root, currentHref) {
        theme.initMobileDrawer();
        theme.initBackToTop();
        if (typeof theme.initCommentForm === 'function') {
            theme.initCommentForm();
        }
        if (typeof theme.initGallery === 'function') {
            theme.initGallery();
        }
        if (typeof theme.initDevices === 'function') {
            theme.initDevices();
        }
        theme.initLazyLoad(root);
        theme.initCodeHighlight(root);
        theme.initLatex(root);
        theme.initPostLightbox(root);
        theme.initTurnstile(root);
        theme.initMotion(root);
        updateActiveNavigation(currentHref);
        document.dispatchEvent(new CustomEvent('netsuko:pjax:ready', { detail: { root: root || document, url: currentHref || window.location.href } }));
    }

    theme.initMotion = function (root) {
        ensureProgressIndicators();
        initMotionEvents();
        restartPageEnter();
        prepareMotionTargets(root || document);
        scheduleReadingProgress();
    };

    function copyHeadAssets(newDocument) {
        var selector = 'link[rel="stylesheet"], style';
        $all(selector, newDocument.head).forEach(function (node) {
            var key = node.tagName.toLowerCase() + ':' + (node.getAttribute('href') || node.textContent);
            var exists = $all(selector, document.head).some(function (current) {
                return key === current.tagName.toLowerCase() + ':' + (current.getAttribute('href') || current.textContent);
            });

            if (!exists) {
                document.head.appendChild(document.importNode(node, true));
            }
        });
    }

    function executeHeadScripts(newDocument) {
        var chain = Promise.resolve();
        $all('script', newDocument.head).forEach(function (script) {
            chain = chain.then(function () {
                return executeScript(script);
            });
        });

        return chain;
    }

    function executeScript(script) {
        return new Promise(function (resolve) {
            var fresh = document.createElement('script');

            Array.prototype.slice.call(script.attributes).forEach(function (attr) {
                fresh.setAttribute(attr.name, attr.value);
            });

            if (script.src) {
                if (loadedExternalScripts[script.src]) {
                    resolve();
                    return;
                }

                loadedExternalScripts[script.src] = true;
                fresh.async = false;
                fresh.onload = resolve;
                fresh.onerror = resolve;
                fresh.src = script.src;
                document.body.appendChild(fresh);
                return;
            }

            fresh.text = script.textContent;
            document.body.appendChild(fresh);
            document.body.removeChild(fresh);
            resolve();
        });
    }

    function executeContainerScripts(container) {
        var chain = Promise.resolve();
        $all('script', container).forEach(function (script) {
            chain = chain.then(function () {
                return executeScript(script);
            });
        });

        return chain;
    }

    function updateActiveNavigation(currentHref) {
        var current = new URL(currentHref || window.location.href, window.location.href);
        $all('#header nav a, #mobile-drawer nav a').forEach(function (link) {
            var url = new URL(link.href, window.location.href);
            var isActive = sameNavigationUrl(url, current);
            link.classList.toggle('text-teal', isActive);
            link.classList.toggle('border-teal', isActive && link.closest('#mobile-drawer'));
            link.classList.toggle('dark:border-teal', isActive && link.closest('#mobile-drawer'));
            link.classList.toggle('netsuko-nav-active', isActive);
            if (isActive) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    }

    function updateDocument(newDocument, currentHref) {
        var oldContainer = $(containerSelector);
        var newContainer = $(containerSelector, newDocument);
        if (!oldContainer || !newContainer) {
            return Promise.reject(new Error('PJAX container is missing'));
        }

        document.title = newDocument.title;
        copyHeadAssets(newDocument);
        oldContainer.innerHTML = newContainer.innerHTML;

        return executeHeadScripts(newDocument).then(function () {
            return executeContainerScripts(oldContainer);
        }).then(function () {
            document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
            runLifecycle(oldContainer, currentHref);
        });
    }

    function scrollAfterNavigation(url) {
        if (url.hash) {
            var target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function navigate(href, options) {
        var url = new URL(href, window.location.href);
        options = options || {};

        closeDrawer();
        setLoading(true);
        document.dispatchEvent(new CustomEvent('netsuko:pjax:start', { detail: { url: url.href } }));

        if (activeRequest) {
            activeRequest.abort();
        }

        activeRequest = new AbortController();
        return fetch(url.href, {
            credentials: 'same-origin',
            signal: activeRequest.signal,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-Netsuko-PJAX': 'true'
            }
        }).then(function (response) {
            if (!response.ok) {
                throw new Error('Unexpected response: ' + response.status);
            }
            return response.text();
        }).then(function (html) {
            var newDocument = new DOMParser().parseFromString(html, 'text/html');
            return updateDocument(newDocument, url.href);
        }).then(function () {
            if (!options.fromPopState) {
                window.history.pushState({ netsukoPjax: true }, '', url.href);
            }
            currentPjaxHref = url.href;
            updateActiveNavigation(url.href);
            scrollAfterNavigation(url);
            document.dispatchEvent(new CustomEvent('netsuko:pjax:complete', { detail: { url: url.href } }));
        }).catch(function (error) {
            if (error.name === 'AbortError') {
                return;
            }
            window.location.href = url.href;
        }).finally(function () {
            setLoading(false);
            activeRequest = null;
        });
    }

    function initPjax() {
        if (!config.enabled || document.documentElement.dataset.netsukoPjaxReady === 'true') {
            return;
        }

        document.documentElement.dataset.netsukoPjaxReady = 'true';
        window.history.replaceState({ netsukoPjax: true }, '', window.location.href);

        document.addEventListener('click', function (event) {
            var link = event.target.closest('a');
            if (!shouldHandleLink(link, event)) {
                return;
            }

            event.preventDefault();
            updateActiveNavigation(link.href);
            navigate(link.href);
        });

        window.addEventListener('popstate', function () {
            var nextUrl = new URL(window.location.href, window.location.href);
            var previousUrl = new URL(currentPjaxHref, window.location.href);

            if (samePageUrl(nextUrl, previousUrl)) {
                currentPjaxHref = nextUrl.href;
                updateActiveNavigation(nextUrl.href);
                return;
            }

            navigate(window.location.href, { fromPopState: true });
        });

    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            runLifecycle(document);
            initPjax();
        });
    } else {
        runLifecycle(document);
        initPjax();
    }
})();
