// Get the article slug from the URL search parameters
const urlParams = new URLSearchParams(window.location.search);
const articleSlug = urlParams.get('slug');
console.log('Article slug:', articleSlug);

// Fetch the article data based on the slug
fetch('articles.json')
  .then(response => response.json())
  .then(data => {
    // Find the article with the matching slug
    const article = data.articles.find(article => article.slug === articleSlug);

    if (article) {
      // Display the full article content
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
      authorElement.textContent = `Author: ${article.author}`;

      const dateElement = document.createElement('p');
      dateElement.textContent = `Date: ${article.date}`;

      document.querySelector('meta[name="description"]').setAttribute('content', article.metaDescription);

      // Set meta keywords
      document.querySelector('meta[name="keywords"]').setAttribute('content', article.metaKeywords.join(', '));

      articleContainer.appendChild(titleElement);
      articleContainer.appendChild(imageElement);
      articleContainer.appendChild(contentElement);
      articleContainer.appendChild(authorElement);
      articleContainer.appendChild(dateElement);
    } else {
      console.error('Article not found');
    }
  })
  .catch(error => console.error('Error fetching article:', error));
