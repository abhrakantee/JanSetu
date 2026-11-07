const reportModal = document.getElementById("reportModal");
const reportForm = document.getElementById("reportForm");
const toast = document.getElementById("toast");

function openReportModal() {
    reportModal.classList.add("active");
    document.body.style.overflow = "hidden";
}

function closeReportModal() {
    reportModal.classList.remove("active");
    document.body.style.overflow = "auto";
}

function scrollToSection(sectionId) {
    document.getElementById(sectionId).scrollIntoView({
        behavior: "smooth"
    });
}

function toggleMenu() {
    document.querySelector("nav").classList.toggle("active");
}

function showToast(message) {
    toast.querySelector("p").textContent = message;
    toast.classList.add("active");

    setTimeout(() => {
        toast.classList.remove("active");
    }, 3500);
}

function saveReport(report) {
    const reports = JSON.parse(localStorage.getItem("jansetuReports")) || [];
    reports.push(report);
    localStorage.setItem("jansetuReports", JSON.stringify(reports));
}

reportForm.addEventListener("submit", function(event) {
    event.preventDefault();

    const report = {
        id: Date.now(),
        title: document.getElementById("issueTitle").value,
        category: document.getElementById("issueCategory").value,
        location: document.getElementById("issueLocation").value,
        description: document.getElementById("issueDescription").value,
        status: "Reported",
        date: new Date().toLocaleDateString()
    };

    saveReport(report);

    reportForm.reset();
    closeReportModal();
    showToast("Issue reported successfully! Thank you for helping your community.");

    const reportedCount = document.getElementById("reportedCount");
    const currentCount = parseInt(reportedCount.textContent.replace(",", ""));
    reportedCount.textContent = (currentCount + 1).toLocaleString();
});

function showAllIssues() {
    const reports = JSON.parse(localStorage.getItem("jansetuReports")) || [];

    if (reports.length === 0) {
        showToast("No new community reports yet.");
        return;
    }

    const latestReport = reports[reports.length - 1];

    alert(
        "Latest Community Report\n\n" +
        "Title: " + latestReport.title + "\n" +
        "Category: " + latestReport.category + "\n" +
        "Location: " + latestReport.location + "\n" +
        "Status: " + latestReport.status
    );
}

window.addEventListener("click", function(event) {
    if (event.target === reportModal) {
        closeReportModal();
    }
});

document.querySelectorAll("nav a").forEach(function(link) {
    link.addEventListener("click", function() {
        document.querySelector("nav").classList.remove("active");
    });
});
// .................................

const typingElement =
    document.getElementById("typing-text");

const words = [
    "Real Progress.",
    "Better Communities.",
    "Stronger Cities.",
    "Positive Change."
];

let wordIndex = 0;
let letterIndex = 0;
let isDeleting = false;

function typeEffect() {
    const currentWord =
        words[wordIndex];

    if (!isDeleting) {
        typingElement.textContent =
            currentWord.substring(
                0,
                letterIndex + 1
            );

        letterIndex++;

        if (
            letterIndex ===
            currentWord.length
        ) {
            isDeleting = true;

            setTimeout(
                typeEffect,
                1800
            );

            return;
        }
    } else {
        typingElement.textContent =
            currentWord.substring(
                0,
                letterIndex - 1
            );

        letterIndex--;

        if (letterIndex === 0) {
            isDeleting = false;

            wordIndex++;

            if (
                wordIndex ===
                words.length
            ) {
                wordIndex = 0;
            }
        }
    }

    setTimeout(
        typeEffect,
        isDeleting ? 60 : 100
    );
}

typeEffect();

// .................................
function initMap() {

    const location = {
        lat: 22.5726,
        lng: 88.3639
    };

    const map = new google.maps.Map(document.getElementById("map"), {
        zoom: 13,
        center: location,
    });

    new google.maps.Marker({
        position: location,
        map: map,
        title: "My Location"
    });

}