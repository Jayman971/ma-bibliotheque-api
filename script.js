// script.js - VERSION OPTIMISÉE POUR POSTGRESQL

// --- Configuration de l'API ---
// ✅ Utilise API_CONFIG défini dans index.html, sinon fallback
const API_BASE_URL = typeof API_CONFIG !== 'undefined' 
    ? API_CONFIG.BASE_URL 
    : 'https://ma-bibliotheque-api.onrender.com/api/v1';
    
const API_KEY_STORAGE_KEY = 'library_api_key';

let currentApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
let currentSortColumn = 'titre';
let currentSortDirection = 'asc';

// ✅ Variables de pagination
let currentPage = 1;
let itemsPerPage = 50;
let totalItems = 0;
let totalPages = 0;

// --- Éléments du DOM ---
const appContainer = document.getElementById('app-container');
const mainNav = document.getElementById('mainNav');

// --- Système de cache amélioré ---
const apiCache = new Map();
// ✅ PostgreSQL est plus performant, on peut cacher un peu plus longtemps
const CACHE_DURATION = typeof API_CONFIG !== 'undefined' && API_CONFIG.CACHE_DURATION 
    ? API_CONFIG.CACHE_DURATION 
    : 60000; // 60 secondes (1 minute)

// ✅ Loader global
let globalLoader = null;

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

// ✅ Afficher/masquer le loader global
function showLoader(message = 'Chargement...') {
    if (!globalLoader) {
        globalLoader = document.createElement('div');
        globalLoader.className = 'global-loader';
        globalLoader.innerHTML = `
            <div class="loader-content">
                <div class="spinner"></div>
                <p class="loader-text">${message}</p>
            </div>
        `;
        document.body.appendChild(globalLoader);
    } else {
        globalLoader.querySelector('.loader-text').textContent = message;
        globalLoader.style.display = 'flex';
    }
}

function hideLoader() {
    if (globalLoader) {
        globalLoader.style.display = 'none';
    }
}

// ✅ AMÉLIORÉ : Appel API avec retry automatique
async function callApi(endpoint, method = 'GET', data = null, needsAuth = true, useCache = false, retries = 2) {
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
    
    // ✅ Cache uniquement pour les GET
    if (method === 'GET') {
        // Anti-cache timestamp uniquement si pas de cache utilisé
        if (!useCache) {
            const separator = endpoint.includes('?') ? '&' : '?';
            finalEndpoint = `${endpoint}${separator}_t=${Date.now()}`;
        }
        
        if (useCache) {
            const cached = apiCache.get(endpoint);
            if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
                console.log('📦 Cache hit:', endpoint);
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

    // ✅ Retry logic avec backoff exponentiel
    for (let attempt = 0; attempt <= retries; attempt++) {
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
                const errorData = await response.json().catch(() => ({ message: 'Erreur inconnue' }));
                throw new Error(errorData.message || `Erreur HTTP: ${response.status}`);
            }
            
            const result = await response.json();
            
            // ✅ Mettre en cache les GET
            if (method === 'GET' && useCache) {
                apiCache.set(endpoint, {
                    data: result,
                    timestamp: Date.now()
                });
                console.log('💾 Mise en cache:', endpoint);
            }
            
            // ✅ Invalider le cache pour les modifications
            if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
                clearCache();
            }
            
            return result;
            
        } catch (error) {
            console.error(`Tentative ${attempt + 1}/${retries + 1} échouée:`, error);
            
            // Si c'est la dernière tentative, on lance l'erreur
            if (attempt === retries) {
                showAlert(`Erreur API : ${error.message}`, 'error');
                throw error;
            }
            
            // ✅ Backoff exponentiel : attendre 1s, puis 2s, puis 4s...
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
    }
}

function clearCache() {
    apiCache.clear();
    console.log('🗑 Cache vidé');
}

// ✅ Vérifier la santé de l'API (compatible PostgreSQL)
async function checkApiHealth() {
    try {
        // ✅ Utilise l'URL de base pour construire l'endpoint health
        const healthUrl = API_BASE_URL.replace('/api/v1', '/api/v1/health');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // Timeout 5s
        
        const health = await fetch(healthUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await health.json();
        console.log('✅ API Health:', data);
        
        // ✅ Vérification compatible PostgreSQL
        return data.status === 'healthy' && data.database === 'connected';
    } catch (error) {
        console.error('❌ API Health check failed:', error);
        return false;
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
    
    // ✅ Réinitialiser la pagination lors du changement de page
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
            <h2>🔐 Connexion à la Bibliothèque</h2>
            <form id="loginForm">
                <div>
                    <label for="username">Nom d'utilisateur:</label>
                    <input type="text" id="username" name="username" required autocomplete="username">
                </div>
                <div>
                    <label for="password">Mot de passe:</label>
                    <input type="password" id="password" name="password" required autocomplete="current-password">
                </div>
                <button type="submit">Se connecter</button>
            </form>
            <div id="apiStatus" class="api-status"></div>
        </div>
    `;
    
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    
    // ✅ Vérifier la santé de l'API
    checkApiHealth().then(isHealthy => {
        const statusDiv = document.getElementById('apiStatus');
        if (isHealthy) {
            statusDiv.innerHTML = '<p style="color: green;">✅ API connectée et prête (PostgreSQL)</p>';
        } else {
            statusDiv.innerHTML = '<p style="color: orange;">⚠ L\'API semble indisponible. Veuillez réessayer.</p>';
        }
    });
}

async function handleLogin(event) {
    event.preventDefault();
    showLoader('Connexion en cours...');
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await callApi('/login', 'POST', { username, password }, false);
        currentApiKey = response.api_key;
        localStorage.setItem(API_KEY_STORAGE_KEY, currentApiKey);
        hideLoader();
        showAlert('Connexion réussie !', 'success');
        renderNavigation();
        showPage('home');
    } catch (error) {
        hideLoader();
        // Erreur déjà gérée par callApi
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
    appContainer.innerHTML = `
        <div class="homepage">
            <h2>📚 Bienvenue dans votre Bibliothèque !</h2>
            <p class="tagline">Organisez, découvrez, et partagez vos lectures préférées.</p>
            <div id="homeStats" class="welcome-stats">
                <div class="spinner"></div>
                <p>Chargement des statistiques...</p>
            </div>
        </div>
    `;
    
    console.time('Chargement stats');
    
    try {
        // ✅ Utilisation de l'endpoint /stats optimisé avec cache
        const stats = await callApi('/stats', 'GET', null, true, true);
        
        const collectionStats = stats.collection || {};
        const wishlistStats = stats.wishlist || {};

        const homeStatsDiv = document.getElementById('homeStats');
        homeStatsDiv.innerHTML = `
            <div class="stat-card">
                <i class="fas fa-book icon"></i>
                <h4>Collection</h4>
                <p class="stat-number">${collectionStats.total || 0}</p>
                <small>livres</small>
            </div>
            <div class="stat-card">
                <i class="fas fa-heart icon"></i>
                <h4>Wishlist</h4>
                <p class="stat-number">${wishlistStats.total || 0}</p>
                <small>souhaits</small>
            </div>
            <div class="stat-card">
                <i class="fas fa-user-alt icon"></i>
                <h4>Livres de J</h4>
                <p class="stat-number">${(collectionStats.mes_livres || 0) + (wishlistStats.mes_souhaits || 0)}</p>
                <small>au total</small>
            </div>
            <div class="stat-card">
                <i class="fas fa-user-friends icon"></i>
                <h4>Livres de K</h4>
                <p class="stat-number">${(collectionStats.livres_k || 0) + (wishlistStats.souhaits_k || 0)}</p>
                <small>au total</small>
            </div>
            <div class="stat-card">
                <i class="fas fa-bookmark icon"></i>
                <h4>À Lire</h4>
                <p class="stat-number">${collectionStats.a_lire || 0}</p>
                <small>livres</small>
            </div>
            <div class="stat-card">
                <i class="fas fa-book-reader icon"></i>
                <h4>En Cours</h4>
                <p class="stat-number">${collectionStats.en_cours || 0}</p>
                <small>livres</small>
            </div>
            <div class="stat-card">
                <i class="fas fa-check-circle icon"></i>
                <h4>Lus</h4>
                <p class="stat-number">${collectionStats.lus || 0}</p>
                <small>livres</small>
            </div>
            <div class="stat-card">
                <i class="fas fa-star icon"></i>
                <h4>Note Moyenne</h4>
                <p class="stat-number">${collectionStats.note_moyenne || 'N/A'}</p>
                <small>sur 5</small>
            </div>
        `;
        
        console.timeEnd('Chargement stats');
    } catch (error) {
        document.getElementById('homeStats').innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Impossible de charger les statistiques</p>
                <small>${error.message}</small>
                <button onclick="showPage('home')" style="margin-top: 10px;">
                    <i class="fas fa-redo"></i> Réessayer
                </button>
            </div>
        `;
    }
}

// --- Page de liste de livres avec PAGINATION ---
async function renderBookListPage(data) {
    const isWishlist = data.isWishlist;
    const pageTitle = isWishlist ? '💖 Ma Wishlist' : '📚 Ma Collection de Livres';
    const endpoint = isWishlist ? '/wishlist' : '/books';

    appContainer.innerHTML = `
        <h2>${pageTitle}</h2>
        <div class="filter-sort-section">
            <div>
                <label for="searchQuery">🔍 Rechercher:</label>
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
                <label for="proprietaireFilter">👤 Propriétaire:</label>
                <select id="proprietaireFilter">
                    <option value="">Tous</option>
                    <option value="J">J</option>
                    <option value="K">K</option>
                </select>
            </div>
            <div>
                <label for="statutFilter">📖 Statut:</label>
                <select id="statutFilter">
                    <option value="">Tous</option>
                    <option value="a_lire">À lire</option>
                    <option value="en_cours">En cours</option>
                    <option value="lu">Lu</option>
                </select>
            </div>` : ''}
            
            <div>
                <label for="itemsPerPageSelect">📄 Par page:</label>
                <select id="itemsPerPageSelect">
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50" selected>50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="1000">Tous</option>
                </select>
            </div>
            
            <div class="filter-buttons">
                <button id="applyFiltersBtn"><i class="fas fa-filter"></i> Filtrer</button>
                <button id="refreshBtn" class="secondary-btn"><i class="fas fa-sync-alt"></i> Actualiser</button>
            </div>
        </div>
        
        <div id="paginationInfo" class="pagination-info"></div>
        
        <div id="bookListContent">
            <div class="spinner"></div>
            <p>Chargement des livres...</p>
        </div>
        
        <div id="paginationControls" class="pagination-controls"></div>
    `;

    document.getElementById('applyFiltersBtn').addEventListener('click', () => {
        currentPage = 1;
        fetchAndRenderBooks(isWishlist);
    });
    
    document.getElementById('refreshBtn').addEventListener('click', () => {
        clearCache();
        fetchAndRenderBooks(isWishlist);
        showAlert('Données actualisées !', 'info', 1500);
    });
    
    document.getElementById('itemsPerPageSelect').addEventListener('change', (e) => {
        itemsPerPage = parseInt(e.target.value);
        currentPage = 1;
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

// ✅ Chargement avec pagination
async function fetchAndRenderBooks(isWishlist) {
    const bookListContent = document.getElementById('bookListContent');
    bookListContent.innerHTML = '<div class="spinner"></div><p>Chargement des livres...</p>';

    const searchQuery = document.getElementById('searchQuery').value.trim();
    const searchBy = document.getElementById('searchBy').value;
    const proprietaireFilter = isWishlist ? '' : (document.getElementById('proprietaireFilter')?.value || '');
    const statutFilter = isWishlist ? '' : (document.getElementById('statutFilter')?.value || '');

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
    
    // ✅ Paramètres de tri et pagination
    queryString.append('sort_by', currentSortColumn);
    queryString.append('sort_dir', currentSortDirection);
    queryString.append('page', currentPage);
    queryString.append('per_page', itemsPerPage);

    const endpoint = isWishlist ? '/wishlist' : '/books';
    
    console.time('Chargement livres');
    
    try {
        // ✅ Utiliser le cache pour améliorer les performances
        const response = await callApi(`${endpoint}?${queryString.toString()}`, 'GET', null, true, true);
        let books = isWishlist ? response.wishlist_books : response.books;
        const stats = response.stats;

        console.timeEnd('Chargement livres');
        
        // ✅ Calculer la pagination
        totalItems = stats.total || 0;
        totalPages = itemsPerPage >= 1000 ? 1 : Math.ceil(totalItems / itemsPerPage);
        
        renderPaginationInfo(books.length);
        
        let html = '';
        if (!isWishlist && stats) {
            html += `
                <div class="stats-bar">
                    <span><strong>${stats.total}</strong> livres</span>
                    <span>📚 J: <strong>${stats.mes_livres}</strong></span>
                    <span>📚 K: <strong>${stats.livres_k}</strong></span>
                    <span>📖 À lire: <strong>${stats.a_lire}</strong></span>
                    <span>📚 En cours: <strong>${stats.en_cours}</strong></span>
                    <span>✅ Lus: <strong>${stats.lus}</strong></span>
                    ${stats.note_moyenne ? `<span>⭐ Moyenne: <strong>${stats.note_moyenne}/5</strong></span>` : ''}
                </div>
            `;
        } else if (isWishlist && stats) {
            html += `
                <div class="stats-bar">
                    <span><strong>${stats.total}</strong> souhaits</span>
                    <span>💖 J: <strong>${stats.mes_souhaits}</strong></span>
                    <span>💖 K: <strong>${stats.souhaits_k}</strong></span>
                </div>
            `;
        }

        if (books.length === 0) {
            html += `
                <div class="empty-state">
                    <i class="fas fa-book-open fa-3x"></i>
                    <p>Aucun livre trouvé ${searchQuery ? 'avec ces critères de recherche' : 'dans ' + (isWishlist ? 'la wishlist' : 'cette catégorie')}</p>
                    ${searchQuery ? '<button onclick="document.getElementById(\'searchQuery\').value=\'\'; fetchAndRenderBooks(' + isWishlist + ')">Effacer la recherche</button>' : ''}
                </div>
            `;
        } else {
            html += `
                <div class="book-table-container">
                    <table class="book-table">
                        <thead>
                            <tr>
                                <th class="sortable ${currentSortColumn === 'titre' ? currentSortDirection : ''}" data-sort="titre">
                                    Titre <span class="sort-icon">${getSortIcon('titre')}</span>
                                </th>
                                <th class="sortable ${currentSortColumn === 'auteur' ? currentSortDirection : ''}" data-sort="auteur">
                                    Auteur <span class="sort-icon">${getSortIcon('auteur')}</span>
                                </th>
                                <th class="sortable ${currentSortColumn === 'proprietaire' ? currentSortDirection : ''}" data-sort="proprietaire">
                                    Propriétaire <span class="sort-icon">${getSortIcon('proprietaire')}</span>
                                </th>
                                ${!isWishlist ? `<th class="sortable ${currentSortColumn === 'note' ? currentSortDirection : ''}" data-sort="note">Note <span class="sort-icon">${getSortIcon('note')}</span></th>` : ''}
                                ${!isWishlist ? `<th class="sortable ${currentSortColumn === 'statut_lecture' ? currentSortDirection : ''}" data-sort="statut_lecture">Statut <span class="sort-icon">${getSortIcon('statut_lecture')}</span></th>` : ''}
                                <th class="actions-cell">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            books.forEach(book => {
                const noteStars = !isWishlist && book.note ? '⭐'.repeat(book.note) : '';
                html += `
                    <tr>
                        <td class="book-title">${escapeHtml(book.titre)}</td>
                        <td>${escapeHtml(book.auteur)}</td>
                        <td><span class="badge">${book.proprietaire}</span></td>
                        ${!isWishlist ? `<td>${noteStars} ${book.note || 0}/5</td>` : ''}
                        ${!isWishlist ? `<td><span class="status-badge status-${book.statut_lecture}">${formatStatut(book.statut_lecture)}</span></td>` : ''}
                        <td class="actions-cell">
                            <button class="btn-edit" onclick="showPage('addBook', { bookId: ${book.id}, isWishlist: ${isWishlist} })" title="Modifier">
                                <i class="fas fa-edit"></i>
                            </button>
                            ${isWishlist ? `
                            <button class="btn-move" onclick="moveToCollection(${book.id})" title="Vers la collection">
                                <i class="fas fa-arrow-right"></i>
                            </button>` : ''}
                            <button class="btn-delete" onclick="deleteBook(${book.id}, ${isWishlist})" title="Supprimer">
                                <i class="fas fa-trash"></i>
                            </button>
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
        renderPaginationControls(isWishlist);

        // ✅ Événements de tri
        document.querySelectorAll('.book-table th.sortable').forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                if (currentSortColumn === column) {
                    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortDirection = 'asc';
                }
                currentPage = 1;
                fetchAndRenderBooks(isWishlist);
            });
        });

    } catch (error) {
        bookListContent.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Erreur lors du chargement des livres</p>
                <small>${error.message}</small>
                <button onclick="fetchAndRenderBooks(${isWishlist})" style="margin-top: 10px;">
                    <i class="fas fa-redo"></i> Réessayer
                </button>
            </div>
        `;
    }
}

// ✅ Formater le statut
function formatStatut(statut) {
    const statuts = {
        'a_lire': 'À lire',
        'en_cours': 'En cours',
        'lu': 'Lu'
    };
    return statuts[statut] || statut;
}

// ✅ Icône de tri
function getSortIcon(column) {
    if (currentSortColumn !== column) return '⇅';
    return currentSortDirection === 'asc' ? '↑' : '↓';
}

// ✅ Échapper le HTML pour éviter les XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// ✅ Afficher les informations de pagination
function renderPaginationInfo(currentPageItems) {
    const paginationInfo = document.getElementById('paginationInfo');
    if (!paginationInfo) return;
    
    if (totalItems === 0) {
        paginationInfo.innerHTML = '';
        return;
    }
    
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(startItem + currentPageItems - 1, totalItems);
    
    paginationInfo.innerHTML = `
        <p class="pagination-text">
            📊 Affichage de <strong>${startItem}</strong> à <strong>${endItem}</strong> 
            sur <strong>${totalItems}</strong> livres
            ${totalPages > 1 ? ` • Page <strong>${currentPage}</strong> sur <strong>${totalPages}</strong>` : ''}
        </p>
    `;
}

// ✅ Afficher les contrôles de pagination
function renderPaginationControls(isWishlist) {
    const paginationControls = document.getElementById('paginationControls');
    if (!paginationControls) return;
    
    if (totalPages <= 1) {
        paginationControls.innerHTML = '';
        return;
    }
    
    let html = '<div class="pagination-buttons">';
    
    html += `<button onclick="goToPage(1, ${isWishlist})" ${currentPage === 1 ? 'disabled' : ''} title="Première page">
                <i class="fas fa-angle-double-left"></i>
             </button>`;
    
    html += `<button onclick="goToPage(${currentPage - 1}, ${isWishlist})" ${currentPage === 1 ? 'disabled' : ''} title="Page précédente">
                <i class="fas fa-angle-left"></i>
             </button>`;
    
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
    
    html += `<button onclick="goToPage(${currentPage + 1}, ${isWishlist})" ${currentPage === totalPages ? 'disabled' : ''} title="Page suivante">
                <i class="fas fa-angle-right"></i>
             </button>`;
    
    html += `<button onclick="goToPage(${totalPages}, ${isWishlist})" ${currentPage === totalPages ? 'disabled' : ''} title="Dernière page">
                <i class="fas fa-angle-double-right"></i>
             </button>`;
    
    html += '</div>';
    
    html += `
        <div class="pagination-goto">
            <label for="gotoPage">Aller à :</label>
            <input type="number" id="gotoPage" min="1" max="${totalPages}" value="${currentPage}" 
                   onkeypress="if(event.key === 'Enter') goToPageInput(${isWishlist})">
            <button onclick="goToPageInput(${isWishlist})">OK</button>
        </div>
    `;
    
    paginationControls.innerHTML = html;
}

// ✅ Calculer les numéros de pages à afficher
function getPageNumbers(current, total) {
    const delta = 2;
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

// ✅ Fonction pour changer de page
function goToPage(pageNum, isWishlist) {
    if (pageNum < 1 || pageNum > totalPages || pageNum === currentPage) return;
    currentPage = pageNum;
    fetchAndRenderBooks(isWishlist);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ✅ Aller à une page via l'input
function goToPageInput(isWishlist) {
    const input = document.getElementById('gotoPage');
    const pageNum = parseInt(input.value);
    
    if (pageNum >= 1 && pageNum <= totalPages) {
        goToPage(pageNum, isWishlist);
    } else {
        showAlert(`Veuillez entrer un numéro entre 1 et ${totalPages}`, 'error', 2000);
        input.value = currentPage;
    }
}

// --- Formulaire d'ajout/modification ---
async function renderAddEditBookForm(data = {}) {
    const bookId = data.bookId;
    const isWishlistEdit = data.isWishlist || false;
    let book = {};
    let formTitle = '➕ Ajouter un Nouveau Livre';
    let isEditing = false;
    
    if (bookId) {
        isEditing = true;
        showLoader('Chargement du livre...');
        try {
            book = await callApi(isWishlistEdit ? `/wishlist/${bookId}` : `/books/${bookId}`);
            formTitle = `✏ Modifier : "${book.titre}"`;
            hideLoader();
        } catch (error) {
            hideLoader();
            showAlert(`Impossible de charger le livre: ${error.message}`, 'error');
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

                <div class="form-group">
                    <label for="titre">📖 Titre <span class="required">*</span></label>
                    <input type="text" id="titre" name="titre" value="${escapeHtml(book.titre || '')}" required>
                </div>

                <div class="form-group">
                    <label for="auteur">✍ Auteur <span class="required">*</span></label>
                    <input type="text" id="auteur" name="auteur" value="${escapeHtml(book.auteur || '')}" required>
                </div>

                ${!isWishlistEdit ? `
                <div class="form-group">
                    <label for="note">⭐ Note (0-5)</label>
                    <input type="number" id="note" name="note" min="0" max="5" value="${book.note || 0}">
                </div>
                ` : ''}

                <div class="form-group">
                    <label for="proprietaire">👤 Propriétaire</label>
                    <select id="proprietaire" name="proprietaire">
                        <option value="J" ${book.proprietaire === 'J' ? 'selected' : ''}>J</option>
                        <option value="K" ${book.proprietaire === 'K' ? 'selected' : ''}>K</option>
                    </select>
                </div>

                ${!isWishlistEdit ? `
                <div class="form-group">
                    <label for="statut_lecture">📚 Statut de lecture</label>
                    <select id="statut_lecture" name="statut_lecture">
                        <option value="lu" ${book.statut_lecture === 'lu' ? 'selected' : ''}>Lu</option>
                        <option value="a_lire" ${book.statut_lecture === 'a_lire' ? 'selected' : ''}>À lire</option>
                        <option value="en_cours" ${book.statut_lecture === 'en_cours' ? 'selected' : ''}>En cours</option>
                    </select>
                </div>
                ` : ''}
                
                ${!isEditing ? `
                <div class="form-group checkbox-group">
                    <label>
                        <input type="checkbox" id="est_wishlist" name="est_wishlist" ${book.est_wishlist ? 'checked' : ''}>
                        💖 Ajouter à la wishlist
                    </label>
                </div>
                ` : ''}

                <div class="form-actions">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-save"></i> ${isEditing ? 'Modifier' : 'Ajouter'}
                    </button>
                    <button type="button" class="btn-secondary" onclick="showPage(${isWishlistEdit ? '\'wishlist\', {isWishlist: true}' : '\'collection\', {isWishlist: false}'})">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                </div>
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
        titre: formData.get('titre').trim(),
        auteur: formData.get('auteur').trim(),
        proprietaire: formData.get('proprietaire')
    };

    if (!isWishlistEdit) {
        bookData.note = parseInt(formData.get('note')) || 0;
        bookData.statut_lecture = formData.get('statut_lecture');
    }

    let endpoint;
    let method;
    let successMessage;

    if (isEditing) {
        endpoint = isWishlistEdit ? `/wishlist/${bookId}` : `/books/${bookId}`;
        method = 'PUT';
        successMessage = '✅ Livre modifié avec succès !';
    } else {
        bookData.est_wishlist = formData.get('est_wishlist') === 'on' ? 1 : 0;
        endpoint = bookData.est_wishlist ? '/wishlist' : '/books';
        method = 'POST';
        successMessage = '✅ Livre ajouté avec succès !';
    }

    showLoader(isEditing ? 'Modification en cours...' : 'Ajout en cours...');

    try {
        await callApi(endpoint, method, bookData);
        clearCache();
        hideLoader();
        showAlert(successMessage, 'success');
        
        setTimeout(() => {
            if (isWishlistEdit || bookData.est_wishlist) {
                showPage('wishlist', { isWishlist: true });
            } else {
                showPage('collection', { isWishlist: false });
            }
        }, 300);
    } catch (error) {
        hideLoader();
        // Erreur déjà gérée
    }
}

async function deleteBook(bookId, isWishlist) {
    if (!confirm('⚠ Êtes-vous sûr de vouloir supprimer ce livre ?')) {
        return;
    }

    showLoader('Suppression en cours...');

    try {
        const endpoint = isWishlist ? `/wishlist/${bookId}` : `/books/${bookId}`;
        const response = await callApi(endpoint, 'DELETE');
        clearCache();
        hideLoader();
        showAlert(response.message, 'success');
        
        setTimeout(() => {
            if (isWishlist) {
                showPage('wishlist', { isWishlist: true });
            } else {
                showPage('collection', { isWishlist: false });
            }
        }, 300);
    } catch (error) {
        hideLoader();
        // Erreur déjà gérée
    }
}

async function moveToCollection(bookId) {
    if (!confirm('📚 Déplacer ce livre vers votre collection ?')) {
        return;
    }
    
    showLoader('Déplacement en cours...');
    
    try {
        const response = await callApi(`/wishlist/${bookId}/move_to_collection`, 'POST');
        clearCache();
        hideLoader();
        showAlert(response.message, 'success');
        
        setTimeout(() => {
            showPage('wishlist', { isWishlist: true });
        }, 300);
    } catch (error) {
        hideLoader();
        // Erreur déjà gérée
    }
}

// --- Initialisation ---
document.addEventListener('DOMContentLoaded', () => {
    console.time('⏱ Initialisation totale');
    
    // ✅ Afficher l'URL de l'API utilisée (pour debug)
    console.log('🔗 API URL:', API_BASE_URL);
    console.log('⏱ Cache duration:', CACHE_DURATION, 'ms');
    
    if (currentApiKey) {
        renderNavigation();
        showPage('home');
    } else {
        showPage('login');
    }
    
    console.timeEnd('⏱ Initialisation totale');
});