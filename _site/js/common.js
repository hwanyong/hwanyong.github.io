document.addEventListener("DOMContentLoaded", function () {
  'use strict';

  /* =======================
  // Animation Load Page
  ======================= */
  setTimeout(function () {
    document.body.classList.add('is-in');
  }, 150);

  const menuOpenIcon = document.querySelector(".nav__icon-menu");
  const menuCloseIcon = document.querySelector(".nav__icon-close");
  const menuList = document.querySelector(".menu-overlay");
  const searchOpenIcon = document.querySelector(".search-button");
  const searchCloseIcon = document.querySelector(".search__close");
  const searchInput = document.querySelector(".search__text");
  const searchBox = document.querySelector(".search");

  /* =======================
  // Menu and Search
  ======================= */
  if (menuOpenIcon) {
    menuOpenIcon.addEventListener("click", () => {
      menuList.classList.add("is-open");
    });
  }

  if (menuCloseIcon) {
    menuCloseIcon.addEventListener("click", () => {
      menuList.classList.remove("is-open");
    });
  }

  if (searchOpenIcon) {
    searchOpenIcon.addEventListener("click", () => {
      searchBox.classList.add("is-visible");
      setTimeout(() => {
        searchInput.focus();
      }, 300);
    });
  }

  if (searchCloseIcon) {
    searchCloseIcon.addEventListener("click", () => {
      searchBox.classList.remove("is-visible");
    });
  }

  const searchElements = document.querySelectorAll('.search, .search__box');
  searchElements.forEach(el => {
    el.addEventListener('click', (event) => {
      if (event.target === el) {
        document.querySelector('.search').classList.remove('is-visible');
      }
    });
    el.addEventListener('keyup', (event) => {
      if (event.key === "Escape") {
        document.querySelector('.search').classList.remove('is-visible');
      }
    });
  });

  /* =======================
  // Simple Jekyll Search
  ======================= */
  if (document.getElementById("js-search-input")) {
    SimpleJekyllSearch({
      searchInput: document.getElementById("js-search-input"),
      resultsContainer: document.getElementById("js-results-container"),
      json: "/search.json",
      searchResultTemplate: '{article}',
      noResultsText: '<li class="no-results"><h3>No results found</h3></li>'
    });
  }

  /* =======================
  // LazyLoad Images
  ======================= */
  var lazyLoadInstance = new LazyLoad({
    elements_selector: '.lazy'
  });

  /* =======================
  // Ajax Load More
  ======================= */
  const loadPostsButton = document.querySelector('.load-more-posts');

  if (loadPostsButton) {
    loadPostsButton.addEventListener('click', function (e) {
      e.preventDefault();
      const loadMoreSection = document.querySelector('.load-more-section');
      const requestNextLink = pagination_next_url.split('/page')[0] + '/page/' + pagination_next_page_number + '/';

      loadPostsButton.textContent = 'Loading...';

      fetch(requestNextLink)
        .then(response => response.text())
        .then(data => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(data, 'text/html');
          const posts = doc.querySelectorAll('.grid__post');
          const grid = document.querySelector('.grid');

          posts.forEach(post => {
            grid.appendChild(post);
          });

          // Re-init lazyload for new elements
          var lazyLoadInstance = new LazyLoad({
            elements_selector: '.lazy'
          });

          loadPostsButton.textContent = 'Load more';
          pagination_next_page_number++;

          if (pagination_next_page_number > pagination_available_pages_number) {
            loadMoreSection.classList.add('hide');
          }
        })
        .catch(error => {
          console.error('Error loading posts:', error);
          loadPostsButton.textContent = 'Error';
        });
    });
  }

  /* =======================
  // Responsive Videos (Vanilla FitVids)
  ======================= */
  function fitVids(selector) {
    const videos = document.querySelectorAll(selector);
    videos.forEach(video => {
      if (video.closest('.fluid-width-video-wrapper')) return; // Already wrapped

      const width = video.getAttribute('width') || video.clientWidth;
      const height = video.getAttribute('height') || video.clientHeight;

      if (!width || !height) return;

      const aspectRatio = (height / width) * 100;

      const wrapper = document.createElement('div');
      wrapper.className = 'fluid-width-video-wrapper';
      wrapper.style.paddingTop = `${aspectRatio}%`;
      wrapper.style.position = 'relative';

      video.parentNode.insertBefore(wrapper, video);
      wrapper.appendChild(video);

      video.style.position = 'absolute';
      video.style.top = '0';
      video.style.left = '0';
      video.style.width = '100%';
      video.style.height = '100%';

      video.removeAttribute('height');
      video.removeAttribute('width');
    });
  }

  fitVids('.post__content iframe[src*="ted.com"], .post__content iframe[src*="player.twitch.tv"], .post__content iframe[src*="facebook.com"], .page__content iframe[src*="ted.com"], .page__content iframe[src*="player.twitch.tv"], .page__content iframe[src*="facebook.com"]');

  /* =======================
  // Zoom Image (Medium Zoom)
  ======================= */
  if (typeof mediumZoom !== 'undefined') {
    mediumZoom(document.querySelectorAll('.page img, .post img, .image-box img'), {
      background: '#151515eb',
      margin: 24,
      scrollOffset: 0
    });

    // Remove zoom from links to avoid conflict (if any remains)
    const linkedImages = document.querySelectorAll('.page a img, .post a img');
    linkedImages.forEach(img => {
      // medium-zoom handles this by selector, but if we need to detach:
      // (This part is usually not needed if selector is correct, but keeping logic similar to old code)
    });
  }

  /* =======================
  // Scroll Top Button
  ======================= */
  const topButton = document.querySelector(".top");
  if (topButton) {
    topButton.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });

    window.addEventListener("scroll", () => {
      if (window.scrollY > window.innerHeight) {
        topButton.classList.add("is-active");
      } else {
        topButton.classList.remove("is-active");
      }
    });
  }

});