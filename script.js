

let header = document.querySelector('.fixed-header');
let lastScrollPosition = 0;



function functionIn1() {
  exp.innerHTML = "Our team comprises highly skilled translators, linguists, and subject matter experts with deep domain knowledge in various industries, ensuring accurate and contextually appropriate translations.";
}

function functionOut1() {
  exp.innerHTML = "1. Expertise and Specialization";
}

function functionIn2() {
  qual.innerHTML = "Quality is at the heart of our operations. We have stringent quality assurance processes in place to ensure that every translation undergoes thorough review and linguistic validation.";
}

function functionOut2() {
  qual.innerHTML = "2. Uncompromising Quality";
}

function functionIn3() {
  clients.innerHTML = "We are proud to serve a diverse range of clients, including multinational corporations, government agencies, educational institutions, and small to medium-sized enterprises.";
}

function functionOut3() {
  clients.innerHTML = "3. Diverse and Loyal Client Base";
}

function functionIn4() {
  reach.innerHTML = "With an extensive network of professional translators and resources in multiple languages, we have the capability to provide translation services for a wide range of language pairs.";
}

function functionOut4() {
  reach.innerHTML = "4. Global Reach and Language Capabilities";
}

function functionIn5() {
  tech.innerHTML = "We embrace cutting-edge translation technologies, including advanced CAT (Computer-Assisted Translation) tools, to enhance our efficiency and accuracy.";
}

function functionOut5() {
  tech.innerHTML = "5. Technological Advancements";
}

function functionIn6() {
  imp.innerHTML = "By embracing innovation and continuously improving our processes, we strive to provide our clients with the most efficient and effective translation solutions available.";
}

function functionOut6() {
  imp.innerHTML = "6. Continuous Improvement and Innovation";
}

window.addEventListener('scroll', function () {
  if (window.innerWidth > 768) {
    let currentScrollPosition = window.scrollY;

    if (currentScrollPosition > lastScrollPosition) {
      header.classList.add('slide-down');
    } else {
      header.classList.remove('slide-down');
    }

    lastScrollPosition = currentScrollPosition;
  }
});

let btn = document.getElementById("submit-button");
btn.addEventListener("click", function(e) {
  e.preventDefault();

  let fullnameInput = document.getElementById("fullname");
  let emailInput = document.getElementById("email");
  let messageInput = document.getElementById("message");

  // Check if the required fields have been filled
  if (fullnameInput.value.trim() === "" || emailInput.value.trim() === "" || messageInput.value.trim() === "") {
    alert("Please fill in all required fields (Full name, Email, and Message) before submitting.");
    return; // Exit the function if the required fields are not filled
  }

  let data = {
    from_name: document.getElementById("fullname").value,
    email_id: document.getElementById("email").value,
    phone_number: document.getElementById("phonenumber").value,
    source_language: document.getElementById("sourcelanguage").value,
    target_language: document.getElementById("targetlanguage").value,
    message: document.getElementById("message").value,
  };

  let modal = document.getElementById("modal");
  let modalBody = document.getElementById("modal-body");

  emailjs.send("service_4thavy7", "template_bfqz58e", data)
    .then(function (response) {
      window.location.href = "success.html";
    })
    .catch(function (error) {
      console.error("Error:", error);
    });
});



  const menu_btn = document.querySelector(".hamburger");
  const mobile_menu = document.querySelector('.mobile-nav');

  menu_btn.addEventListener('click', function () {
    menu_btn.classList.toggle('is-active');
    mobile_menu.classList.toggle('is-active');
  });

  

  let navbar = document.querySelector('.mobile-nav');
  let sticky = navbar.offsetTop;

  function myFunction() {
    if (window.scrollY >= sticky) {
      navbar.classList.add("sticky");
    } else {
      navbar.classList.remove("sticky");
    }
  }

  window.onscroll = function () {
    myFunction();
  };




window.onload = function () {
  const values = document.querySelector(".hover");
  if (window.innerWidth < 768) {
    values.innerHTML = "Click on each value to learn more.";
  }
}


