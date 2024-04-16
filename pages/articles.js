
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
    
      // Create anchor element for title
      const titleLinkElement = document.createElement('a');
      titleLinkElement.href = `article.html?slug=${article.slug}`;
      titleLinkElement.textContent = article.title;
    
      // Wrap titleLinkElement inside an h2 element
      const titleElement = document.createElement('h2');
      titleElement.appendChild(titleLinkElement);
    
      // Append the h2 element to the article card
      articleCard.appendChild(titleElement);
    
      const contentElement = document.createElement('div');
      contentElement.classList.add('content');
      
      // Truncate the content to the first 300 characters and add ellipsis
      const truncatedContent = article.content.length > 300 ? article.content.substring(0, 300) + '...' : article.content;
      contentElement.textContent = truncatedContent;
    
      const readMoreLink = document.createElement('a');
      readMoreLink.textContent = 'Read more';
      readMoreLink.href = `article.html?slug=${article.slug}`;
    
      articleCard.appendChild(imageElement);
      articleCard.appendChild(contentElement);
      articleCard.appendChild(readMoreLink);
    
      blogContainer.appendChild(articleCard);
    });
    
    
  })
  .catch(error => console.error('Error fetching articles:', error));
