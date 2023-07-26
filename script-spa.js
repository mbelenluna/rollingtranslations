let header = document.querySelector('.fixed-header');
let lastScrollPosition = 0;



function functionIn1() {
    exp.innerHTML = "Nuestro equipo está compuesto por traductores y lingüistas altamente calificados, que también son expertos en industrias específicas, lo cual garantiza que las traducciones sean precisas y adecuadas al contexto.";
}

function functionOut1() {
    exp.innerHTML = "1. Experiencia y especialización";
}

function functionIn2() {
    qual.innerHTML = "La calidad es la protagonista de nuestras operaciones. Establecemos estrictos procesos de control de calidad para garantizar una revisión exhaustiva y validación lingüística de nuestras traducciones.";
}

function functionOut2() {
    qual.innerHTML = "2. Calidad absoluta";
}

function functionIn3() {
    clients.innerHTML = "Nos enorgullece atender a una diversa base de clientes: empresas multinacionales, organismos gubernamentales, institutos educativos y pequeñas y medianas empresas.";
}

function functionOut3() {
    clients.innerHTML = "3. Base de clientes fieles y diversos";
}

function functionIn4() {
    reach.innerHTML = "With an extensive network of professional translators and resources in multiple languages, we have the capability to provide translation services for a wide range of language pairs.";
}

function functionOut4() {
    reach.innerHTML = "4. Alcance global y capacidad lingüística";
}

function functionIn5() {
    tech.innerHTML = "We embrace cutting-edge translation technologies, including advanced CAT (Computer-Assisted Translation) tools, to enhance our efficiency and accuracy.";
}

function functionOut5() {
    tech.innerHTML = "5. Avances tecnológicos";
}

function functionIn6() {
    imp.innerHTML = "By embracing innovation and continuously improving our processes, we strive to provide our clients with the most efficient and effective translation solutions available.";
}

function functionOut6() {
    imp.innerHTML = "6. Mejora e innovación continua";
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
btn.addEventListener("click", function (e) {
    e.preventDefault();

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
            modal.style.display = "block";
            let goBackButton = document.getElementById("go-back-button");
            goBackButton.addEventListener("click", function (e) {
                modal.style.display = "none";
            })
            let crossButton = document.getElementById("close-button");
            crossButton.addEventListener("click", function (e) {
                modal.style.display = "none";
            })
        })
        .catch(function (error) {
            console.error("Error:", error);
        });
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

const values = document.querySelector(".hover");
if (window.innerWidth < 768) {
    values.innerHTML = "Click on each value to learn more.";
}

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