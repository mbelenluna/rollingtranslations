let header = document.querySelector('.fixed-header');
let lastScrollPosition = 0;




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