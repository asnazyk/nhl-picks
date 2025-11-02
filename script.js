// Smooth-scroll "Enter League" button to standings
document.addEventListener("DOMContentLoaded", () => {
  const cta = document.querySelector('[data-jump="standings"]');
  const target = document.getElementById("standings");
  if (cta && target) {
    cta.addEventListener("click", (e) => {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Sortable standings (client-side)
  const table = document.querySelector("[data-sortable='standings']");
  if (table) {
    const tbody = table.querySelector("tbody");
    const headers = table.querySelectorAll("th[data-sort]");
    headers.forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort"); // 'team' or 'points'
        const rows = Array.from(tbody.querySelectorAll("tr"));
        const dir = th.getAttribute("data-dir") === "asc" ? "desc" : "asc";
        th.setAttribute("data-dir", dir);

        rows.sort((a, b) => {
          const av = a.querySelector(`[data-${key}]`).textContent.trim();
          const bv = b.querySelector(`[data-${key}]`).textContent.trim();
          if (key === "points") {
            return dir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
          }
          // team name compare
          return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        });

        rows.forEach((r) => tbody.appendChild(r));
      });
    });
  }

  // Picks “toast” feedback
  const weekSelect = document.querySelector("[data-week-select]");
  if (weekSelect) {
    weekSelect.addEventListener("change", () => {
      showToast(`Showing picks for Week ${weekSelect.value}`);
    });
  }
});

function showToast(msg) {
  let bar = document.querySelector(".toast");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "toast";
    document.body.appendChild(bar);
  }
  bar.textContent = msg;
  bar.classList.add("show");
  setTimeout(() => bar.classList.remove("show"), 1600);
}
