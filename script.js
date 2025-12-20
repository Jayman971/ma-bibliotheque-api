// script.js - VERSION AVEC PAGINATION

// --- Configuration de l'API ---
const API_BASE_URL = 'https://ma-bibliotheque-api.onrender.com/api/v1';
const API_KEY_STORAGE_KEY = 'library_api_key';

let currentApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
let currentSortColumn = 'titre';
let currentSortDirection = 'asc';

// ✅ NOUVEAU : Variables de pagination
let currentPage = 1;
let itemsPerPage = 50; // Nombre de livres par page (modifiable)
let totalItems = 0;
let totalPages = 0;

// --- Éléments du DOM ---
const appContainer = document.getElementById('app-container');
const mainNav = document.getElementById('mainNav');

// --- Système de cache ---
const apiCache = new Map();
const CACHE_DURATION = 30000;

// --- Fonctions utilitaires ---

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

async function callApi(endpoint, method = 'GET', data = null, needsAuth = true, useCache = false) {
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

    let finalEndpoint = endpoint;
    if (method === 'GET') {
        const separator = endpoint.includes('?') ? '&' : '?';
        finalEndpoint = `${endpoint}${separator}_t=${Date.now()}`;
        
        if (useCache) {
            const cached = apiCache.get(endpoint);
            if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
                console.log('📦 Utilisation du cache pour:', endpoint);
                return cached.data;
            }
        }
    }

    const options = {
        method: method,
        headers: headers,
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        console.time(`API ${method} ${endpoint}`);
        const response = await fetch(`${API_BASE_URL}${finalEndpoint}`, options);
        console.timeEnd(`API ${method} ${endpoint}`);
        
        if (response.status === 401) {
            showAlert('Session expirée ou non valide. Veuillez vous reconnecter.', 'error');
            logout();
            return;
        }
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Erreur HTTP: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (method === 'GET' && useCache) {
            apiCache.set(endpoint, {
                data: result,
                timestamp: Date.now()
            });
        }
        
        if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
            clearCache();
        }
        
        return result;
    } catch (error) {
        console.error("Erreur d'appel API:", error);
        showAlert(`Erreur API : ${error.message}`, 'error');
        throw error;
    }
}

function clearCache() {
    apiCache.clear();
    console.log('🗑 Cache vidé');
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
    
    // ✅ NOUVEAU : Réinitialiser la pagination lors du changement de page
    currentPage = 1;
    
    document.querySelectorAll('#mainNav button').forEach(btn => btn.classList.remove('active'));
    const currentButton = document.getElementById(`${pageName}Btn`);
    if (currentButton) {
        currentButton.classList.add('active');
    }

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
    mainNav.innerHTML = '';
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
        const response = await callApi('/login', 'POST', { username, password }, false);
        currentApiKey = response.api_key;
        localStorage.setItem(API_KEY_STORAGE_KEY, currentApiKey);
        showAlert('Connexion réussie !', 'success');
        renderNavigation();
        showPage('home');
    } catch (error) {
        // Erreur déjà gérée
    }
}

function logout() {
    currentApiKey = null;
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    clearCache();
    showAlert('Vous avez été déconnecté.', 'info');
    showPage('login');
}

// --- Page d'accueil ---
async function renderHomePage() {
    appContainer.innerHTML = '<div class="homepage"><h2>Bienvenue dans votre Bibliothèque !</h2><p class="tagline">Organisez, découvrez, et partagez vos lectures préférées.</p><div id="homeStats" class="welcome-stats">Chargement des statistiques...</div></div>';
    
    console.time('Chargement stats');
    
    try {
        // ✅ Utilisation de l'endpoint /stats optimisé
        const stats = await callApi('/stats', 'GET', null, true, true);
        
        const collectionStats = stats.collection;
        const wishlistStats = stats.wishlist;

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
        
        console.timeEnd('Chargement stats');
    } catch (error) {
        document.getElementById('homeStats').innerHTML = `<p style="color: red;">Impossible de charger les statistiques : ${error.message}</p>`;
    }
}

// --- Page de liste de livres avec PAGINATION ---
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
            
            <!-- ✅ NOUVEAU : Sélecteur d'éléments par page -->
            <div>
                <label for="itemsPerPageSelect">Livres par page:</label>
                <select id="itemsPerPageSelect">
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50" selected>50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="1000">Tous</option>
                </select>
            </div>
            
            <div>
                <button id="applyFiltersBtn">Appliquer les filtres</button>
                <button id="refreshBtn" style="margin-left: 10px;">🔄 Rafraîchir</button>
            </div>
        </div>
        
        <!-- ✅ NOUVEAU : Informations de pagination en haut -->
        <div id="paginationInfo" class="pagination-info"></div>
        
        <div id="bookListContent">Chargement des livres...</div>
        
        <!-- ✅ NOUVEAU : Contrôles de pagination en bas -->
        <div id="paginationControls" class="pagination-controls"></div>
    `;

    document.getElementById('applyFiltersBtn').addEventListener('click', () => {
        currentPage = 1; // Réinitialiser à la page 1 lors d'une nouvelle recherche
        fetchAndRenderBooks(isWishlist);
    });
    
    document.getElementById('refreshBtn').addEventListener('click', () => {
        clearCache();
        fetchAndRenderBooks(isWishlist);
        showAlert('Données rafraîchies !', 'info', 1500);
    });
    
    // ✅ NOUVEAU : Changement du nombre d'éléments par page
    document.getElementById('itemsPerPageSelect').addEventListener('change', (e) => {
        itemsPerPage = parseInt(e.target.value);
        currentPage = 1; // Retour à la page 1
        fetchAndRenderBooks(isWishlist);
    });
    
    document.getElementById('searchQuery').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            currentPage = 1;
            fetchAndRenderBooks(isWishlist);
        }
    });

    fetchAndRenderBooks(isWishlist);
}

// ✅ OPTIMISÉ : Chargement avec pagination
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
    
    // ✅ NOUVEAU : Paramètres de tri
    queryString.append('sort_by', currentSortColumn);
    queryString.append('sort_dir', currentSortDirection);
    
    // ✅ NOUVEAU : Paramètres de pagination
    queryString.append('page', currentPage);
    queryString.append('per_page', itemsPerPage);

    const endpoint = isWishlist ? '/wishlist' : '/books';
    
    console.time('Chargement livres');
    
    try {
        const response = await callApi(`${endpoint}?${queryString.toString()}`);
        let books = isWishlist ? response.wishlist_books : response.books;
        const stats = response.stats;

        console.timeEnd('Chargement livres');
        
        // ✅ NOUVEAU : Calculer le nombre total de pages
        totalItems = stats.total;
        totalPages = Math.ceil(totalItems / itemsPerPage);
        
        // ✅ Afficher les informations de pagination
        renderPaginationInfo(books.length);
        
        let html = '';
        if (!isWishlist && stats) {
            html += `<div class="stats"><p>Total livres : <strong>${stats.total}</strong></p></div>`;
        } else if (isWishlist && stats) {
            html += `<div class="stats"><p>Total dans la wishlist : <strong>${stats.total}</strong></p></div>`;
        }

        if (books.length === 0) {
            html += `<p>Aucun livre trouvé dans ${isWishlist ? 'la wishlist' : 'la collection'} avec ces critères.</p>`;
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

        // ✅ Afficher les contrôles de pagination
        renderPaginationControls(isWishlist);

        // Ajouter les écouteurs pour le tri
        document.querySelectorAll('.book-table th.sortable').forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                if (currentSortColumn === column) {
                    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortDirection = 'asc';
                }
                currentPage = 1; // Retour à la page 1 lors d'un nouveau tri
                fetchAndRenderBooks(isWishlist);
            });
        });

    } catch (error) {
        bookListContent.innerHTML = `<p style="color: red;">Erreur lors du chargement des livres: ${error.message}</p>`;
    }
}

// ✅ NOUVEAU : Afficher les informations de pagination
function renderPaginationInfo(currentPageItems) {
    const paginationInfo = document.getElementById('paginationInfo');
    if (!paginationInfo) return;
    
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(startItem + currentPageItems - 1, totalItems);
    
    paginationInfo.innerHTML = `
        <p class="pagination-text">
            Affichage de <strong>${startItem}</strong> à <strong>${endItem}</strong> 
            sur <strong>${totalItems}</strong> livres
            ${totalPages > 1 ? `(Page ${currentPage} sur ${totalPages})` : ''}
        </p>
    `;
}

// ✅ NOUVEAU : Afficher les contrôles de pagination
function renderPaginationControls(isWishlist) {
    const paginationControls = document.getElementById('paginationControls');
    if (!paginationControls) return;
    
    if (totalPages <= 1) {
        paginationControls.innerHTML = '';
        return;
    }
    
    let html = '<div class="pagination-buttons">';
    
    // Bouton "Première page"
    html += `<button onclick="goToPage(1, ${isWishlist})" ${currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-angle-double-left"></i> Première
             </button>`;
    
    // Bouton "Page précédente"
    html += `<button onclick="goToPage(${currentPage - 1}, ${isWishlist})" ${currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-angle-left"></i> Précédent
             </button>`;
    
    // Numéros de pages (logique intelligente)
    const pageNumbers = getPageNumbers(currentPage, totalPages);
    pageNumbers.forEach(pageNum => {
        if (pageNum === '...') {
            html += `<span class="pagination-ellipsis">...</span>`;
        } else {
            html += `<button onclick="goToPage(${pageNum}, ${isWishlist})" 
                            class="${pageNum === currentPage ? 'active' : ''}">
                        ${pageNum}
                     </button>`;
        }
    });
    
    // Bouton "Page suivante"
    html += `<button onclick="goToPage(${currentPage + 1}, ${isWishlist})" ${currentPage === totalPages ? 'disabled' : ''}>
                Suivant <i class="fas fa-angle-right"></i>
             </button>`;
    
    // Bouton "Dernière page"
    html += `<button onclick="goToPage(${totalPages}, ${isWishlist})" ${currentPage === totalPages ? 'disabled' : ''}>
                Dernière <i class="fas fa-angle-double-right"></i>
             </button>`;
    
    html += '</div>';
    
    // ✅ Aller directement à une page
    html += `
        <div class="pagination-goto">
            <label for="gotoPage">Aller à la page :</label>
            <input type="number" id="gotoPage" min="1" max="${totalPages}" value="${currentPage}" 
                   onkeypress="if(event.key === 'Enter') goToPageInput(${isWishlist})">
            <button onclick="goToPageInput(${isWishlist})">Go</button>
        </div>
    `;
    
    paginationControls.innerHTML = html;
}

// ✅ NOUVEAU : Calculer les numéros de pages à afficher
function getPageNumbers(current, total) {
    const delta = 2; // Nombre de pages à afficher avant/après la page actuelle
    const range = [];
    const rangeWithDots = [];
    let l;

    for (let i = 1; i <= total; i++) {
        if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
            range.push(i);
        }
    }

    for (let i of range) {
        if (l) {
            if (i - l === 2) {
                rangeWithDots.push(l + 1);
            } else if (i - l !== 1) {
                rangeWithDots.push('...');
            }
        }
        rangeWithDots.push(i);
        l = i;
    }

    return rangeWithDots;
}

// ✅ NOUVEAU : Fonction pour changer de page
function goToPage(pageNum, isWishlist) {
    if (pageNum < 1 || pageNum > totalPages || pageNum === currentPage) return;
    currentPage = pageNum;
    fetchAndRenderBooks(isWishlist);
    
    // Scroll en haut de la page
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ✅ NOUVEAU : Aller à une page via l'input
function goToPageInput(isWishlist) {
    const input = document.getElementById('gotoPage');
    const pageNum = parseInt(input.value);
    
    if (pageNum >= 1 && pageNum <= totalPages) {
        goToPage(pageNum, isWishlist);
    } else {
        showAlert(`Veuillez entrer un numéro de page entre 1 et ${totalPages}`, 'error', 2000);
        input.value = currentPage;
    }
}

// --- Formulaire d'ajout/modification ---
async function renderAddEditBookForm(data = {}) {
    const bookId = data.bookId;
    const isWishlistEdit = data.isWishlist || false;
    let book = {};
    let formTitle = 'Ajouter un Nouveau Livre';
    let isEditing = false;
    
    if (bookId) {
        isEditing = true;
        try {
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

    if (!isWishlistEdit) {
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
        clearCache();
        showAlert(successMessage, 'success');
        
        setTimeout(() => {
            if (isWishlistEdit || bookData.est_wishlist) {
                showPage('wishlist', { isWishlist: true });
            } else {
                showPage('collection', { isWishlist: false });
            }
        }, 300);
    } catch (error) {
        // Erreur déjà gérée
    }
}

async function deleteBook(bookId, isWishlist) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce livre ?')) {
        return;
    }

    try {
        const endpoint = isWishlist ? `/wishlist/${bookId}` : `/books/${bookId}`;
        const response = await callApi(endpoint, 'DELETE');
        clearCache();
        showAlert(response.message, 'info');
        
        setTimeout(() => {
            if (isWishlist) {
                showPage('wishlist', { isWishlist: true });
            } else {
                showPage('collection', { isWishlist: false });
            }
        }, 300);
    } catch (error) {
        // Erreur déjà gérée
    }
}

async function moveToCollection(bookId) {
    if (!confirm('Voulez-vous déplacer ce livre vers votre collection ?')) {
        return;
    }
    try {
        const response = await callApi(`/wishlist/${bookId}/move_to_collection`, 'POST');
        clearCache();
        showAlert(response.message, 'success');
        
        setTimeout(() => {
            showPage('wishlist', { isWishlist: true });
        }, 300);
    } catch (error) {
        // Erreur déjà gérée
    }
}

// --- Initialisation ---
document.addEventListener('DOMContentLoaded', () => {
    console.time('Initialisation totale');
    
    if (currentApiKey) {
        renderNavigation();
        showPage('home');
    } else {
        showPage('login');
    }
    
    console.timeEnd('Initialisation totale');
});