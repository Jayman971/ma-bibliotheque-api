const API_BASE_URL = typeof API_CONFIG !== 'undefined' ? API_CONFIG.BASE_URL : 'https://ma-bibliotheque-api.onrender.com/api/v1';
const API_KEY_STORAGE_KEY = 'library_api_key';

let currentApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
let currentSortColumn = 'titre';
let currentSortDirection = 'asc';
let currentPage = 1;
let itemsPerPage = 50;

const appContainer = document.getElementById('app-container');
const mainNav = document.getElementById('mainNav');

// Utilitaires de base
function showToast(message, type = 'info') { alert(`${type.toUpperCase()}: ${message}`); }
function showLoader() { /* Code loader */ }
function hideLoader() { /* Code loader */ }
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeBookModal() { closeModal('bookModal'); }
function closeConfirmModal() { closeModal('confirmModal'); }
function showConfirmDialog(title, msg, onConfirm) {
    if(confirm(`${title}\n${msg}`)) onConfirm();
}

async function callApi(endpoint, method = 'GET', data = null, needsAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (needsAuth) headers['Authorization'] = `Bearer ${currentApiKey}`;
    const options = { method, headers };
    if (data) options.body = JSON.stringify(data);
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    if (!response.ok) throw new Error('Erreur API');
    return await response.json();
}

// ====== ROUTEUR ======
const pages = {
    'home': renderHomePage,
    'collection': renderBookListPage,
    'login': renderLoginPage
};

function showPage(pageName, data = {}) {
    if (!currentApiKey && pageName !== 'login') { renderLoginPage(); return; }
    document.querySelectorAll('#mainNav button').forEach(btn => btn.classList.remove('active'));
    if(document.getElementById(`${pageName}Btn`)) document.getElementById(`${pageName}Btn`).classList.add('active');
    pages[pageName](data);
}

function renderNavigation() {
    mainNav.innerHTML = `
        <div class="nav-left">
            <button id="homeBtn">Accueil</button>
            <button id="collectionBtn">Collection</button>
        </div>
        <div class="nav-right">
            <button id="addBookBtn" class="btn-primary">Ajouter</button>
            <button id="logoutBtn">Déconnexion</button>
        </div>
    `;
    document.getElementById('homeBtn').onclick = () => showPage('home');
    document.getElementById('collectionBtn').onclick = () => showPage('collection', { isWishlist: false });
    document.getElementById('addBookBtn').onclick = () => openAddBookModal(false);
    document.getElementById('logoutBtn').onclick = () => { currentApiKey = null; localStorage.removeItem(API_KEY_STORAGE_KEY); showPage('login'); };
}

function renderLoginPage() {
    mainNav.innerHTML = '';
    appContainer.innerHTML = `
        <div class="login-container">
            <h2>Connexion</h2>
            <form id="loginForm">
                <input type="text" id="username" placeholder="Nom d'utilisateur" required>
                <input type="password" id="password" placeholder="Mot de passe" required>
                <button type="submit">Se connecter</button>
            </form>
        </div>
    `;
    document.getElementById('loginForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await callApi('/login', 'POST', {
                username: document.getElementById('username').value,
                password: document.getElementById('password').value
            }, false);
            currentApiKey = res.api_key;
            localStorage.setItem(API_KEY_STORAGE_KEY, currentApiKey);
            renderNavigation();
            showPage('home');
        } catch(e) { alert("Erreur de connexion"); }
    };
}

// ====== PAGE D'ACCUEIL (AVEC OBJECTIF ET RECOMMANDATIONS) ======
async function renderHomePage() {
    appContainer.innerHTML = `
        <div class="homepage">
            <h2>📚 Accueil</h2>
            <div id="goalContainer"></div>
            <div id="homeStats" class="welcome-stats">Chargement...</div>
            <div id="recoContainer" class="reco-container">
                <h3>💡 Suggestions de lecture</h3>
                <div id="recoGrid" class="reco-grid"><div class="spinner"></div></div>
            </div>
        </div>
    `;
    
    try {
        const stats = await callApi('/stats');
        const col = stats.collection;
        
        // ✅ 1. Barre de progression Objectif (Basé sur l'année en cours)
        const objectGoal = 20; // Ton objectif annuel de livres
        const readThisYear = col.lus_cette_annee || 0;
        const percent = Math.min((readThisYear / objectGoal) * 100, 100);
        
        document.getElementById('goalContainer').innerHTML = `
            <div class="goal-container">
                <h3>🎯 Objectif de lecture de l'année</h3>
                <div class="goal-bar-bg">
                    <div class="goal-bar-fill" style="width: 0%"></div>
                    <div class="goal-text">${readThisYear} / ${objectGoal} livres lus</div>
                </div>
            </div>
        `;
        setTimeout(() => document.querySelector('.goal-bar-fill').style.width = `${percent}%`, 300);

        // Stats standard
        document.getElementById('homeStats').innerHTML = `
            <div class="stat-card"><h4>Collection</h4><p class="stat-number">${col.total}</p></div>
            <div class="stat-card"><h4>Lus</h4><p class="stat-number">${col.lus}</p></div>
        `;

        // ✅ 2. Suggestions via l'API Google Books (basé sur un de tes auteurs)
        fetchGoogleBooksRecommendations();

    } catch(e) { console.error(e); }
}

async function fetchGoogleBooksRecommendations() {
    const recoGrid = document.getElementById('recoGrid');
    try {
        // Pour l'exemple, on récupère un auteur au hasard dans ta collection
        const booksData = await callApi('/books?per_page=50');
        if(!booksData.books || booksData.books.length === 0) {
            recoGrid.innerHTML = "<p>Ajoute des livres pour avoir des recommandations !</p>";
            return;
        }
        
        // Trouver l'auteur le plus fréquent
        const authors = booksData.books.map(b => b.auteur);
        const mostFrequentAuthor = authors.sort((a,b) => authors.filter(v => v===a).length - authors.filter(v => v===b).length).pop();

        // Appel API Google
        const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=inauthor:"${encodeURIComponent(mostFrequentAuthor)}"&maxResults=4`);
        const data = await response.json();
        
        if(data.items) {
            recoGrid.innerHTML = data.items.map(item => {
                const info = item.volumeInfo;
                const thumb = info.imageLinks ? info.imageLinks.thumbnail : 'https://via.placeholder.com/128x192?text=Pas+d%27image';
                return `
                    <div class="reco-card" onclick="window.open('${info.infoLink}', '_blank')">
                        <img src="${thumb}" alt="Couverture">
                        <h4>${info.title}</h4>
                        <small>${info.authors ? info.authors.join(', ') : 'Inconnu'}</small>
                    </div>
                `;
            }).join('');
        } else {
            recoGrid.innerHTML = "<p>Aucune suggestion trouvée pour le moment.</p>";
        }
    } catch(e) {
        recoGrid.innerHTML = "<p>Erreur lors du chargement des recommandations.</p>";
    }
}

// ====== PAGE COLLECTION ======
async function renderBookListPage(data) {
    appContainer.innerHTML = `
        <h2>📚 Ma Collection</h2>
        <div class="filter-sort-section">
            <button id="addBookPageBtn" class="btn-primary">Ajouter</button>
            <button id="cleanDuplicatesBtn" class="btn-clean" style="margin-left:auto;"><i class="fas fa-broom"></i> Gérer les doublons</button>
        </div>
        <div id="bookListContent">Chargement...</div>
    `;

    document.getElementById('addBookPageBtn').onclick = () => openAddBookModal(false);
    
    // ✅ Action Gérer les doublons
    document.getElementById('cleanDuplicatesBtn').onclick = openDuplicatesManager;

    fetchAndRenderBooks();
}

async function fetchAndRenderBooks() {
    try {
        const response = await callApi('/books');
        const books = response.books;
        
        let html = `
            <table class="book-table">
                <thead><tr><th>Titre</th><th>Auteur</th><th>Lieu</th><th>Statut</th><th>Actions</th></tr></thead>
                <tbody>
        `;
        
        books.forEach(book => {
            // ✅ Formatage visuel du lieu physique
            let lieuBadge = '';
            if (book.lieu === 'J') lieuBadge = '📍 Chez Jérémy';
            else if (book.lieu === 'K') lieuBadge = '📍 Chez Kelly';
            else lieuBadge = '🤝 Prêté';

            html += `
                <tr>
                    <td>${book.titre}</td>
                    <td>${book.auteur}</td>
                    <td><strong>${lieuBadge}</strong></td>
                    <td>${book.statut_lecture}</td>
                    <td>
                        <button class="btn-edit" onclick="editBookInModal(${book.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn-delete" onclick="deleteBook(${book.id})"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table>`;
        document.getElementById('bookListContent').innerHTML = html;
    } catch(e) { console.error(e); }
}

// ====== GESTION DU FORMULAIRE ET DU LIEU ======
function openAddBookModal() {
    document.getElementById('bookForm').reset();
    document.getElementById('bookId').value = '';
    document.getElementById('bookModalTitle').textContent = 'Ajouter un livre';
    openModal('bookModal');
}

async function editBookInModal(id) {
    const book = await callApi(`/books/${id}`);
    document.getElementById('bookId').value = book.id;
    document.getElementById('bookTitre').value = book.titre;
    document.getElementById('bookAuteur').value = book.auteur;
    document.getElementById('bookProprietaire').value = book.proprietaire;
    
    // ✅ On pré-remplit le lieu
    document.getElementById('bookLieu').value = book.lieu || book.proprietaire; 
    document.getElementById('bookStatut').value = book.statut_lecture;
    
    document.getElementById('bookModalTitle').textContent = 'Modifier';
    openModal('bookModal');
}

document.getElementById('bookForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('bookId').value;
    const payload = {
        titre: document.getElementById('bookTitre').value,
        auteur: document.getElementById('bookAuteur').value,
        proprietaire: document.getElementById('bookProprietaire').value,
        lieu: document.getElementById('bookLieu').value, // ✅ Envoi du lieu
        statut_lecture: document.getElementById('bookStatut').value
    };

    try {
        if(id) await callApi(`/books/${id}`, 'PUT', payload);
        else await callApi('/books', 'POST', payload);
        closeBookModal();
        fetchAndRenderBooks();
    } catch(err) { alert("Erreur form"); }
};

async function deleteBook(id) {
    if(confirm("Supprimer ce livre ?")) {
        await callApi(`/books/${id}`, 'DELETE');
        fetchAndRenderBooks();
    }
}

// ====== GESTION DES DOUBLONS ======
async function openDuplicatesManager() {
    openModal('duplicatesModal');
    const content = document.getElementById('duplicatesContent');
    content.innerHTML = '<div class="spinner"></div><p>Analyse de la bibliothèque...</p>';

    try {
        const response = await callApi('/books/duplicates');
        const doublons = response.doublons;

        if (!doublons || doublons.length === 0) {
            content.innerHTML = '<p style="text-align:center; color:green;">✅ Super, aucun doublon détecté dans votre collection !</p>';
            return;
        }

        let html = '<p>Voici les livres détectés en plusieurs exemplaires :</p>';
        doublons.forEach(groupe => {
            html += `<div style="margin-bottom: 20px; background: var(--bg-secondary); padding: 15px; border-radius: 8px;">
                        <h4>📖 ${groupe.titre}</h4>`;
            
            groupe.livres.forEach((livre, index) => {
                html += `
                    <div class="duplicate-item">
                        <span>ID: ${livre.id} - Proprio: ${livre.proprietaire} - Lieu: ${livre.lieu}</span>
                        <button onclick="deleteDuplicate(${livre.id})" class="btn-delete" title="Supprimer cet exemplaire">
                            <i class="fas fa-trash"></i> Supprimer
                        </button>
                    </div>`;
            });
            html += `</div>`;
        });
        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = '<p>Erreur lors de la recherche des doublons.</p>';
    }
}

// Supprime spécifiquement un doublon sans recharger toute la page
async function deleteDuplicate(id) {
    if(confirm("Êtes-vous sûr de vouloir supprimer cet exemplaire ?")) {
        await callApi(`/books/${id}`, 'DELETE');
        openDuplicatesManager(); // Rafraîchit juste la modale
        fetchAndRenderBooks(); // Rafraîchit le tableau derrière
    }
}

// Initialisation
if(currentApiKey) { renderNavigation(); showPage('home'); } 
else { showPage('login'); }