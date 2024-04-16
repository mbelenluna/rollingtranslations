
fetch('articles.json')
  .then(response => response.json())
  .then(data => {
    const blogContainer = document.getElementById('blog-container');

    data.articles.forEach(article => {
      const articleCard = document.createElement('div');
      articleCard.classList.add('card');

      const imageElement = document.createElement('img');
      imageElement.src = article.image;
      imageElement.alt = article.title;

      const titleElement = document.createElement('h2');
      titleElement.textContent = article.title;

      const contentElement = document.createElement('div');
      contentElement.classList.add('content');
      
      // Truncate the content to the first 100 characters and add ellipsis
      const truncatedContent = article.content.length > 300 ? article.content.substring(0, 300) + '...' : article.content;
      contentElement.textContent = truncatedContent;

      const readMoreLink = document.createElement('a');
      readMoreLink.textContent = 'Read more';
      readMoreLink.href = `article.html?slug=${article.slug}`;

      articleCard.appendChild(imageElement);
      articleCard.appendChild(titleElement);
      articleCard.appendChild(contentElement);
      articleCard.appendChild(readMoreLink);

      blogContainer.appendChild(articleCard);
    });
  })
  .catch(error => console.error('Error fetching articles:', error));
