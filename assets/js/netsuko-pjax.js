(function () {
    'use strict';

    var theme = window.NetsukoTheme = window.NetsukoTheme || {};
    var config = window.NetsukoPjaxConfig || {};
    var containerSelector = config.container || '#netsuko-pjax-container';
    var activeRequest = null;
    var loadedExternalScripts = {};
    var progressTimer = null;
    var loadingStartedAt = 0;

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
        ensureProgressBar();
        window.clearTimeout(progressTimer);

        document.documentElement.classList.toggle('netsuko-pjax-loading', isLoading);
        document.body.classList.toggle('netsuko-pjax-loading', isLoading);

        if (isLoading) {
            loadingStartedAt = Date.now();
            document.documentElement.classList.remove('netsuko-pjax-done');
            document.documentElement.dataset.netsukoPjaxState = 'loading';
            return;
        }

        document.documentElement.classList.add('netsuko-pjax-done');
        document.documentElement.dataset.netsukoPjaxState = 'ready';
        progressTimer = window.setTimeout(function () {
            document.documentElement.classList.remove('netsuko-pjax-done');
        }, 420);
    }

    function finishLoading() {
        var elapsed = Date.now() - loadingStartedAt;
        var delay = Math.max(0, 280 - elapsed);

        window.setTimeout(function () {
            setLoading(false);
        }, delay);
    }

    function ensureProgressBar() {
        if ($('#netsuko-pjax-progress')) {
            return;
        }

        var progress = document.createElement('div');
        progress.id = 'netsuko-pjax-progress';
        progress.setAttribute('aria-hidden', 'true');
        document.body.appendChild(progress);
    }

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

    function runLifecycle(root) {
        theme.initMobileDrawer();
        theme.initBackToTop();
        if (typeof theme.initCommentForm === 'function') {
            theme.initCommentForm();
        }
        if (typeof theme.initGallery === 'function') {
            theme.initGallery();
        }
        theme.initTurnstile(root);
        updateActiveNavigation();
        document.dispatchEvent(new CustomEvent('netsuko:pjax:ready', { detail: { root: root || document } }));
    }

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

    function updateActiveNavigation() {
        var current = new URL(window.location.href);
        $all('#header nav a, #mobile-drawer nav a').forEach(function (link) {
            var url = new URL(link.href, window.location.href);
            var isActive = samePageUrl(url, current);
            link.classList.toggle('text-teal', isActive);
            link.classList.toggle('border-teal', isActive && link.closest('#mobile-drawer'));
            link.classList.toggle('dark:border-teal', isActive && link.closest('#mobile-drawer'));
        });
    }

    function updateDocument(newDocument) {
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
            runLifecycle(oldContainer);
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
            return updateDocument(newDocument);
        }).then(function () {
            if (!options.fromPopState) {
                window.history.pushState({ netsukoPjax: true }, '', url.href);
            }
            scrollAfterNavigation(url);
            document.dispatchEvent(new CustomEvent('netsuko:pjax:complete', { detail: { url: url.href } }));
        }).catch(function (error) {
            if (error.name === 'AbortError') {
                return;
            }
            window.location.href = url.href;
        }).finally(function () {
            finishLoading();
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
            navigate(link.href);
        });

        window.addEventListener('popstate', function () {
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
