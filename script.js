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

window.onload = function () {
    let servicesMenuItem = document.querySelector(".item-dropdown");
    let dropdownMenu = document.getElementById("dropdown-menu");

    servicesMenuItem.addEventListener("mouseover", showDropdownMenu);
    servicesMenuItem.addEventListener("mouseout", hideDropdownMenu);

    function showDropdownMenu() {
        dropdownMenu.style.display = "block";
    }

    function hideDropdownMenu() {
        dropdownMenu.style.display = "none";
    }

    const menu_btn = document.querySelector(".hamburger");
    const mobile_menu = document.querySelector('.mobile-nav');

    menu_btn.addEventListener('click', function () {
        menu_btn.classList.toggle('is-active');
        mobile_menu.classList.toggle('is-active');
    })

};

let exp = document.querySelector(".exp");
let qual = document.querySelector(".qual");
let clients = document.querySelector(".clients");
let reach = document.querySelector(".reach");
let tech = document.querySelector(".tech");
let imp = document.querySelector(".imp");

exp.addEventListener("mouseover", functionIn1);
exp.addEventListener("mouseout", functionOut1);
qual.addEventListener("mouseover", functionIn2);
qual.addEventListener("mouseout", functionOut2);
clients.addEventListener("mouseover", functionIn3);
clients.addEventListener("mouseout", functionOut3);
reach.addEventListener("mouseover", functionIn4);
reach.addEventListener("mouseout", functionOut4);
tech.addEventListener("mouseover", functionIn5);
tech.addEventListener("mouseout", functionOut5);
imp.addEventListener("mouseover", functionIn6);
imp.addEventListener("mouseout", functionOut6);

// Add this code to your existing JavaScript code
let navbar = document.querySelector('.mobile-nav');
let scrollPosition = window.pageYOffset || document.documentElement.scrollTop;





window.onscroll = function () {
    myFunction()
};

let navbarmobile = document.querySelector(".mobile-nav");
let sticky = navbar.offsetTop;

function myFunction() {
    if (window.scrollY >= sticky) {
        navbar.classList.add("sticky")
    } else {
        navbar.classList.remove("sticky");
    }
}