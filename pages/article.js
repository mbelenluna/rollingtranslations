// Get the article slug from the URL search parameters
const urlParams = new URLSearchParams(window.location.search);
const articleSlug = urlParams.get('slug');

const BASE_URL = 'https://rolling-translations.com';
const SITE_NAME = 'Rolling Translations';

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function truncate(str, maxLen) {
  const cleaned = str.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen - 3).trim() + '...';
}

function getArticleDescription(article) {
  if (article.metaDescription && article.metaDescription.trim()) {
    return truncate(article.metaDescription.trim(), 160);
  }
  const plain = stripHtml(article.content);
  return truncate(plain, 160);
}

function getArticleImage(article) {
  if (article.image && article.image.startsWith('http')) return article.image;
  if (article.image && article.image.startsWith('../')) {
    return BASE_URL + '/' + article.image.replace('../', '');
  }
  return BASE_URL + '/images/logo.png';
}

function updateArticleMetadata(article) {
  const desc = getArticleDescription(article);
  const articleUrl = BASE_URL + '/pages/article.html?slug=' + encodeURIComponent(article.slug);
  const imgUrl = getArticleImage(article);

  document.title = article.title + ' | ' + SITE_NAME + ' Blog';

  const descMeta = document.querySelector('meta[name="description"]');
  if (descMeta) descMeta.setAttribute('content', desc);

  let canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.setAttribute('href', articleUrl);
  } else {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = articleUrl;
    document.head.appendChild(canonical);
  }

  const ogProps = [
    ['og:title', article.title],
    ['og:description', desc],
    ['og:url', articleUrl],
    ['og:image', imgUrl]
  ];
  ogProps.forEach(function (pair) {
    let el = document.querySelector('meta[property="' + pair[0] + '"]');
    if (el) el.setAttribute('content', pair[1]);
  });

  const twitterProps = [
    ['twitter:title', article.title],
    ['twitter:description', desc]
  ];
  twitterProps.forEach(function (pair) {
    let el = document.querySelector('meta[name="' + pair[0] + '"]');
    if (el) el.setAttribute('content', pair[1]);
  });
}

// Fetch the article data based on the slug
fetch('articles.json')
  .then(function (response) { return response.json(); })
  .then(function (data) {
    const article = data.articles.find(function (a) { return a.slug === articleSlug; });

    if (article) {
      updateArticleMetadata(article);

      const articleContainer = document.getElementById('article-container');

      const titleElement = document.createElement('h2');
      titleElement.textContent = article.title;

      const imageElement = document.createElement('img');
      imageElement.src = article.image;
      imageElement.alt = article.title;

      const contentElement = document.createElement('p');
      contentElement.innerHTML = article.content;
      contentElement.classList.add('content');

      const authorElement = document.createElement('p');
      authorElement.textContent = 'Author: ' + article.author;

      const dateElement = document.createElement('p');
      dateElement.textContent = 'Date: ' + article.date;

      articleContainer.appendChild(titleElement);
      articleContainer.appendChild(imageElement);
      articleContainer.appendChild(contentElement);
      articleContainer.appendChild(authorElement);
      articleContainer.appendChild(dateElement);
    } else {
      console.error('Article not found');
    }
  })
  .catch(function (error) { console.error('Error fetching article:', error); });
