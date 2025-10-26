// script.js

// --- Configuration de l'API ---
const API_BASE_URL = 'https://ma-bibliotheque-api.onrender.com/api/v1';
const API_KEY_STORAGE_KEY = 'library_api_key'; // Clé pour stocker l'API Key dans localStorage

let currentApiKey = localStorage.getItem(API_KEY_STORAGE_KEY); // Tente de récupérer la clé au démarrage
let currentSortColumn = 'titre'; // Colonne de tri par défaut
let currentSortDirection = 'asc'; // Direction de tri par défaut

// --- Éléments du DOM ---
const appContainer = document.getElementById('app-container');
const mainNav = document.getElementById('mainNav');

// --- Fonctions utilitaires ---

// Affiche un message d'alerte temporaire
function showAlert(message, type = 'success', duration = 3000) {
    let alertDiv = document.querySelector('.alert-message');
    if (!alertDiv) {
        alertDiv = document.createElement('div');
        alertDiv.classList.add('alert-message');
        appContainer.prepend(alertDiv);
    }

    alertDiv.textContent = message;
    alertDiv.className = `alert-message visible ${type}`;

    setTimeout(() => {
        alertDiv.classList.remove('visible');
    }, duration);
}

// Effectue une requête à l'API Flask
async function callApi(endpoint, method = 'GET', data = null, needsAuth = true) {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (needsAuth) {
        if (!currentApiKey) {
            showAlert('Authentification requise. Veuillez vous connecter.', 'error');
            showPage('login');
            throw new Error('API Key manquante pour une requête authentifiée.');
        }
        headers['Authorization'] = `Bearer ${currentApiKey}`;
    }

    const options = {
        method: method,
        headers: headers,
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        if (response.status === 401) { // Unauthorized
            showAlert('Session expirée ou non valide. Veuillez vous reconnecter.', 'error');
            logout(); // Force la déconnexion
            return;
        }
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Erreur HTTP: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Erreur d'appel API:", error);
        showAlert(`Erreur API : ${error.message}`, 'error');
        throw error;
    }
}

// --- Système de routage/pages ---
const pages = {
    'home': renderHomePage,
    'collection': renderBookListPage,
    'wishlist': renderBookListPage,
    'addBook': renderAddEditBookForm,
    'login': renderLoginPage
};

function showPage(pageName, data = {}) {
    if (!currentApiKey && pageName !== 'login') {
        renderLoginPage();
        return;
    }
    // Mise à jour de l'état actif des boutons de navigation
    document.querySelectorAll('#mainNav button').forEach(btn => btn.classList.remove('active'));
    const currentButton = document.getElementById(`${pageName}Btn`);
    if (currentButton) {
        currentButton.classList.add('active');
    }

    // Nettoyer l'app-container des messages d'alerte précédents (sauf si c'est pour un nouveau message)
    const existingAlert = document.querySelector('.alert-message');
    if (existingAlert) {
        existingAlert.remove();
    }

    if (pages[pageName]) {
        pages[pageName](data);
    } else {
        appContainer.innerHTML = '<h2>Page non trouvée</h2><p>La page demandée n\'existe pas.</p>';
    }
}

// --- Rendu de la navigation ---
function renderNavigation() {
    mainNav.innerHTML = `
        <button id="homeBtn"><i class="fas fa-home"></i> Accueil</button>
        <button id="collectionBtn"><i class="fas fa-book"></i> Ma Collection</button>
        <button id="wishlistBtn"><i class="fas fa-heart"></i> Ma Wishlist</button>
        <button id="addBookBtn"><i class="fas fa-plus"></i> Ajouter un Livre</button>
        <button id="logoutBtn"><i class="fas fa-sign-out-alt"></i> Déconnexion</button>
    `;

    document.getElementById('homeBtn').addEventListener('click', () => showPage('home'));
    document.getElementById('collectionBtn').addEventListener('click', () => showPage('collection', { isWishlist: false }));
    document.getElementById('wishlistBtn').addEventListener('click', () => showPage('wishlist', { isWishlist: true }));
    document.getElementById('addBookBtn').addEventListener('click', () => showPage('addBook'));
    document.getElementById('logoutBtn').addEventListener('click', logout);
}

// --- Page de connexion ---
function renderLoginPage() {
    mainNav.innerHTML = ''; // Cacher la navigation principale
    appContainer.innerHTML = `
        <div class="login-container">
            <h2>Connexion à la Bibliothèque</h2>
            <form id="loginForm">
                <div>
                    <label for="username">Nom d'utilisateur:</label>
                    <input type="text" id="username" name="username" required>
                </div>
                <div>
                    <label for="password">Mot de passe:</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit">Se connecter</button>
            </form>
        </div>
    `;
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await callApi('/login', 'POST', { username, password }, false); // Pas d'auth pour le login
        currentApiKey = response.api_key;
        localStorage.setItem(API_KEY_STORAGE_KEY, currentApiKey);
        showAlert('Connexion réussie !', 'success');
        renderNavigation(); // Afficher la navigation après connexion
        showPage('home'); // Rediriger vers la page d'accueil
    } catch (error) {
        // showAlert est déjà appelé par callApi en cas d'erreur
    }
}

function logout() {
    currentApiKey = null;
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    showAlert('Vous avez été déconnecté.', 'info');
    showPage('login');
}

// --- Page d'accueil ---
async function renderHomePage() {
    appContainer.innerHTML = '<div class="homepage"><h2>Bienvenue dans votre Bibliothèque !</h2><p class="tagline">Organisez, découvrez, et partagez vos lectures préférées.</p><div id="homeStats" class="welcome-stats">Chargement des statistiques...</div></div>';
    
    try {
        const collectionResponse = await callApi('/books'); 
        const wishlistResponse = await callApi('/wishlist'); 

        const collectionStats = collectionResponse.stats;
        const wishlistStats = wishlistResponse.stats;

        const homeStatsDiv = document.getElementById('homeStats');
        homeStatsDiv.innerHTML = `
            <div class="stat-card">
                <i class="fas fa-books icon"></i>
                <h4>Total Livres</h4>
                <p>${collectionStats.total + wishlistStats.total}</p>
            </div>
            <div class="stat-card">
                <i class="fas fa-user-alt icon"></i>
                <h4>Livres de J</h4>
                <p>${collectionStats.mes_livres + wishlistStats.mes_souhaits}</p>
            </div>
            <div class="stat-card">
                <i class="fas fa-user-friends icon"></i>
                <h4>Livres de K</h4>
                <p>${collectionStats.livres_k + wishlistStats.souhaits_k}</p>
            </div>
            <div class="stat-card">
                <i class="fas fa-bookmark icon"></i>
                <h4>À Lire</h4>
                <p>${collectionStats.a_lire}</p>
            </div>
            <div class="stat-card">
                <i class="fas fa-heart icon"></i>
                <h4>Wishlist</h4>
                <p>${wishlistStats.total}</p>
            </div>
        `;
    } catch (error) {
        document.getElementById('homeStats').innerHTML = `<p style="color: red;">Impossible de charger les statistiques : ${error.message}</p>`;
    }
}


// --- Page de liste de livres (Collection/Wishlist) ---
async function renderBookListPage(data) {
    const isWishlist = data.isWishlist;
    const pageTitle = isWishlist ? 'Ma Wishlist' : 'Ma Collection de Livres';
    const endpoint = isWishlist ? '/wishlist' : '/books';

    appContainer.innerHTML = `
        <h2>${pageTitle}</h2>
        <div class="filter-sort-section">
            <div>
                <label for="searchQuery">Rechercher par Titre/Auteur:</label>
                <input type="text" id="searchQuery" placeholder="Titre ou Auteur">
            </div>
            <div>
                <label for="searchBy">Rechercher dans:</label>
                <select id="searchBy">
                    <option value="titre">Titre</option>
                    <option value="auteur">Auteur</option>
                </select>
            </div>
            ${!isWishlist ? `
            <div>
                <label for="proprietaireFilter">Propriétaire:</label>
                <select id="proprietaireFilter">
                    <option value="">Tous</option>
                    <option value="J">J</option>
                    <option value="K">K</option>
                </select>
            </div>
            <div>
                <label for="statutFilter">Statut de lecture:</label>
                <select id="statutFilter">
                    <option value="">Tous</option>
                    <option value="a_lire">À lire</option>
                    <option value="en_cours">En cours</option>
                    <option value="lu">Lu</option>
                </select>
            </div>` : ''}
            <div>
                <button id="applyFiltersBtn">Appliquer les filtres</button>
            </div>
        </div>
        <div id="bookListContent">Chargement des livres...</div>
    `;

    document.getElementById('applyFiltersBtn').addEventListener('click', () => fetchAndRenderBooks(isWishlist));
    document.getElementById('searchQuery').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') fetchAndRenderBooks(isWishlist);
    });

    fetchAndRenderBooks(isWishlist);
}


async function fetchAndRenderBooks(isWishlist) {
    const bookListContent = document.getElementById('bookListContent');
    bookListContent.innerHTML = '<p>Chargement des livres...</p>';

    const searchQuery = document.getElementById('searchQuery').value;
    const searchBy = document.getElementById('searchBy').value;
    const proprietaireFilter = isWishlist ? '' : document.getElementById('proprietaireFilter').value;
    const statutFilter = isWishlist ? '' : document.getElementById('statutFilter').value;

    let queryString = new URLSearchParams();
    if (searchQuery) {
        queryString.append('query', searchQuery);
        queryString.append('search_by', searchBy);
    }
    if (proprietaireFilter) {
        queryString.append('proprietaire', proprietaireFilter);
    }
    if (statutFilter) {
        queryString.append('statut', statutFilter);
    }

    const endpoint = isWishlist ? '/wishlist' : '/books';
    try {
        const response = await callApi(`${endpoint}?${queryString.toString()}`);
        let books = isWishlist ? response.wishlist_books : response.books;
        const stats = response.stats; // Stats restent là mais simplifiées visuellement

        // Tri côté client
        books.sort((a, b) => {
            let valA, valB;
            switch (currentSortColumn) {
                case 'titre':
                    valA = a.titre.toLowerCase();
                    valB = b.titre.toLowerCase();
                    break;
                case 'auteur':
                    valA = a.auteur.toLowerCase();
                    valB = b.auteur.toLowerCase();
                    break;
                case 'note':
                    valA = a.note || 0;
                    valB = b.note || 0;
                    break;
                case 'proprietaire':
                    valA = a.proprietaire.toLowerCase();
                    valB = b.proprietaire.toLowerCase();
                    break;
                case 'statut_lecture':
                    valA = a.statut_lecture ? a.statut_lecture.toLowerCase() : '';
                    valB = b.statut_lecture ? b.statut_lecture.toLowerCase() : '';
                    break;
                default:
                    valA = a.titre.toLowerCase();
                    valB = b.titre.toLowerCase();
            }

            if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
            return 0;
        });


        let html = '';
        if (!isWishlist && stats) { // Stats simplifiées pour la collection
            html += `<div class="stats"><p>Total livres : <strong>${stats.total}</strong></p></div>`;
        } else if (isWishlist && stats) { // Stats simplifiées pour la wishlist
            html += `<div class="stats"><p>Total dans la wishlist : <strong>${stats.total}</strong></p></div>`;
        }


        if (books.length === 0) {
            html += `<p>Aucun livre trouvé dans ${pageTitle.toLowerCase()} avec ces critères.</p>`;
        } else {
            html += `
                <div class="book-table-container">
                    <table class="book-table">
                        <thead>
                            <tr>
                                <th class="sortable ${currentSortColumn === 'titre' ? currentSortDirection : ''}" data-sort="titre">Titre <span class="sort-icon"></span></th>
                                <th class="sortable ${currentSortColumn === 'auteur' ? currentSortDirection : ''}" data-sort="auteur">Auteur <span class="sort-icon"></span></th>
                                <th class="sortable ${currentSortColumn === 'proprietaire' ? currentSortDirection : ''}" data-sort="proprietaire">Propriétaire <span class="sort-icon"></span></th>
                                ${!isWishlist ? `<th class="sortable ${currentSortColumn === 'note' ? currentSortDirection : ''}" data-sort="note">Note <span class="sort-icon"></span></th>` : ''}
                                ${!isWishlist ? `<th class="sortable ${currentSortColumn === 'statut_lecture' ? currentSortDirection : ''}" data-sort="statut_lecture">Statut <span class="sort-icon"></span></th>` : ''}
                                <th class="actions-cell">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            books.forEach(book => {
                html += `
                    <tr>
                        <td>${book.titre}</td>
                        <td>${book.auteur}</td>
                        <td>${book.proprietaire}</td>
                        ${!isWishlist ? `<td>${book.note || 'N/A'}/5</td>` : ''}
                        ${!isWishlist ? `<td>${book.statut_lecture}</td>` : ''}
                        <td class="actions-cell">
                            <button onclick="showPage('addBook', { bookId: ${book.id}, isWishlist: ${isWishlist} })">Modifier</button>
                            ${isWishlist ? `<button onclick="moveToCollection(${book.id})">À la collection</button>` : ''}
                            <button class="delete-btn" onclick="deleteBook(${book.id}, ${isWishlist})">Supprimer</button>
                        </td>
                    </tr>
                `;
            });
            html += `
                        </tbody>
                    </table>
                </div>
            `;
        }
        bookListContent.innerHTML = html;

        // Ajouter les écouteurs d'événements pour le tri après que le tableau est rendu
        document.querySelectorAll('.book-table th.sortable').forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                if (currentSortColumn === column) {
                    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortDirection = 'asc';
                }
                fetchAndRenderBooks(isWishlist); // Re-rendre avec le nouveau tri
            });
        });

    } catch (error) {
        bookListContent.innerHTML = `<p style="color: red;">Erreur lors du chargement des livres: ${error.message}</p>`;
    }
}


// --- Formulaire d'ajout/modification (réutilisé) ---
async function renderAddEditBookForm(data = {}) {
    const bookId = data.bookId;
    const isWishlistEdit = data.isWishlist || false;
    let book = {};
    let formTitle = 'Ajouter un Nouveau Livre';
    let isEditing = false;
    
    // Si un bookId est fourni, c'est une modification
    if (bookId) {
        isEditing = true;
        try {
            // Utilisation des nouveaux endpoints GET spécifiques à la wishlist ou collection
            book = await callApi(isWishlistEdit ? `/wishlist/${bookId}` : `/books/${bookId}`);
            formTitle = `Modifier le Livre: "${book.titre}"`;
        } catch (error) {
            showAlert(`Impossible de charger les détails du livre pour modification: ${error.message}`, 'error');
            return;
        }
    }

    appContainer.innerHTML = `
        <div class="book-form-container">
            <h2>${formTitle}</h2>
            <form id="bookForm">
                <input type="hidden" id="bookId" value="${book.id || ''}">
                <input type="hidden" id="isEditing" value="${isEditing}">
                <input type="hidden" id="isWishlistEdit" value="${isWishlistEdit}">

                <label for="titre">Titre:</label>
                <input type="text" id="titre" name="titre" value="${book.titre || ''}" required><br>

                <label for="auteur">Auteur:</label>
                <input type="text" id="auteur" name="auteur" value="${book.auteur || ''}" required><br>

                ${!isWishlistEdit ? `
                <label for="note">Note (0-5):</label>
                <input type="number" id="note" name="note" min="0" max="5" value="${book.note || 0}"><br>
                ` : ''}

                <label for="proprietaire">Propriétaire:</label>
                <select id="proprietaire" name="proprietaire">
                    <option value="J" ${book.proprietaire === 'J' ? 'selected' : ''}>J</option>
                    <option value="K" ${book.proprietaire === 'K' ? 'selected' : ''}>K</option>
                </select><br>

                ${!isWishlistEdit ? `
                <label for="statut_lecture">Statut de lecture:</label>
                <select id="statut_lecture" name="statut_lecture">
                    <option value="lu" ${book.statut_lecture === 'lu' ? 'selected' : ''}>Lu</option>
                    <option value="a_lire" ${book.statut_lecture === 'a_lire' ? 'selected' : ''}>À lire</option>
                    <option value="en_cours" ${book.statut_lecture === 'en_cours' ? 'selected' : ''}>En cours</option>
                </select><br>
                ` : ''}
                
                ${!isEditing ? `
                <label for="est_wishlist">Ajouter à la wishlist:</label>
                <input type="checkbox" id="est_wishlist" name="est_wishlist" ${book.est_wishlist ? 'checked' : ''}><br>
                ` : ''}

                <button type="submit">${isEditing ? 'Modifier le Livre' : 'Ajouter le Livre'}</button>
            </form>
        </div>
    `;

    document.getElementById('bookForm').addEventListener('submit', handleAddEditBookSubmit);
}

async function handleAddEditBookSubmit(event) {
    event.preventDefault();

    const bookId = document.getElementById('bookId').value;
    const isEditing = document.getElementById('isEditing').value === 'true';
    const isWishlistEdit = document.getElementById('isWishlistEdit').value === 'true';

    const formData = new FormData(event.target);
    const bookData = {
        titre: formData.get('titre'),
        auteur: formData.get('auteur'),
        proprietaire: formData.get('proprietaire')
    };

    if (!isWishlistEdit) { // Seulement pour la collection (note, statut)
        bookData.note = parseInt(formData.get('note'));
        bookData.statut_lecture = formData.get('statut_lecture');
    }

    let endpoint;
    let method;
    let successMessage;

    if (isEditing) {
        endpoint = isWishlistEdit ? `/wishlist/${bookId}` : `/books/${bookId}`;
        method = 'PUT';
        successMessage = 'Livre modifié avec succès !';
    } else {
        bookData.est_wishlist = formData.get('est_wishlist') === 'on' ? 1 : 0;
        endpoint = bookData.est_wishlist ? '/wishlist' : '/books';
        method = 'POST';
        successMessage = 'Livre ajouté avec succès !';
    }

    try {
        await callApi(endpoint, method, bookData);
        showAlert(successMessage, 'success');
        if (isWishlistEdit || bookData.est_wishlist) {
            showPage('wishlist', { isWishlist: true });
        } else {
            showPage('collection', { isWishlist: false });
        }
    } catch (error) {
        // showAlert est déjà appelé par callApi
    }
}


// Supprimer un livre
async function deleteBook(bookId, isWishlist) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce livre ?')) {
        return;
    }

    try {
        const endpoint = isWishlist ? `/wishlist/${bookId}` : `/books/${bookId}`;
        const response = await callApi(endpoint, 'DELETE');
        showAlert(response.message, 'info');
        if (isWishlist) {
            showPage('wishlist', { isWishlist: true });
        } else {
            showPage('collection', { isWishlist: false });
        }
    } catch (error) {
        // L'erreur est déjà appelée par callApi
    }
}

// Déplacer de la wishlist vers la collection
async function moveToCollection(bookId) {
    if (!confirm('Voulez-vous déplacer ce livre vers votre collection ?')) {
        return;
    }
    try {
        const response = await callApi(`/wishlist/${bookId}/move_to_collection`, 'POST');
        showAlert(response.message, 'success');
        showPage('wishlist', { isWishlist: true }); // Recharger la wishlist après le déplacement
    } catch (error) {
        // L'erreur est déjà appelée par callApi
    }
}

// --- Initialisation au chargement de la page ---
document.addEventListener('DOMContentLoaded', () => {
    if (currentApiKey) {
        renderNavigation();
        showPage('home'); // Si connecté, affiche la page d'accueil
    } else {
        showPage('login'); // Sinon, affiche la page de connexion
    }
});