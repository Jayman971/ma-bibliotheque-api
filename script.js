// --- Configuration de l'API ---
const API_BASE_URL = typeof API_CONFIG !== 'undefined' 
    ? API_CONFIG.BASE_URL 
    : 'https://ma-bibliotheque-api.onrender.com/api/v1';
    
const API_KEY_STORAGE_KEY = 'library_api_key';
const DARK_MODE_KEY = 'library_dark_mode';
const CURRENT_USER_ID_KEY = 'library_current_user_id';

let currentApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
let currentUserId = parseInt(localStorage.getItem(CURRENT_USER_ID_KEY)) || 1;
let currentSortColumn = 'titre';
let currentSortDirection = 'asc';

// ✅ Variables de pagination
let currentPage = 1;
let itemsPerPage = 50;
let totalItems = 0;
let totalPages = 0;

// ✅ Variables pour les catégories
let allCategories = [];

// --- Éléments du DOM ---
const appContainer = document.getElementById('app-container');
const mainNav = document.getElementById('mainNav');

// --- Système de cache amélioré ---
const apiCache = new Map();
const CACHE_DURATION = typeof API_CONFIG !== 'undefined' && API_CONFIG.CACHE_DURATION 
    ? API_CONFIG.CACHE_DURATION 
    : 60000; // 60 secondes

// ✅ Loader global
let globalLoader = null;

// ====== SYSTÈME DE TOAST NOTIFICATIONS ======

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) {
        console.warn('Toast container not found');
        return;
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = {
        'success': 'fa-check-circle',
        'error': 'fa-times-circle',
        'warning': 'fa-exclamation-triangle',
        'info': 'fa-info-circle'
    }[type] || 'fa-info-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Animation d'entrée
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Retrait automatique
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
    
    // Clic pour fermer
    toast.addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    });
}

// ====== MODE SOMBRE AMÉLIORÉ ======

function initDarkMode() {
    const savedTheme = localStorage.getItem(DARK_MODE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const isDark = savedTheme === 'true' || (savedTheme === null && prefersDark);
    
    if (isDark) {
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
    } else {
        document.body.classList.remove('dark-mode');
        document.body.classList.add('light-mode');
    }
}

async function saveDarkModePreference(isDark) {
    try {
        await callApi(`/users/${currentUserId}/preferences`, 'PUT', { dark_mode: isDark }, true, false);
    } catch (error) {
        console.warn('Impossible de sauvegarder la préférence:', error);
    }
}

// ====== FONCTIONS UTILITAIRES ======

function showAlert(message, type = 'success', duration = 3000) {
    showToast(message, type, duration);
}

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

// ====== GESTION DES MODALS ======

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    } else {
        console.warn(`Modal ${modalId} not found`);
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

function closeBookModal() {
    closeModal('bookModal');
}

function closeLoanModal() {
    closeModal('loanModal');
}

function closeUserModal() {
    closeModal('userModal');
}

function closeConfirmModal() {
    closeModal('confirmModal');
}

// Modal de confirmation personnalisée
function showConfirmDialog(title, message, onConfirm) {
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const confirmBtn = document.getElementById('confirmBtn');
    
    if (!titleEl || !messageEl || !confirmBtn) {
        console.error('Confirm modal elements not found');
        if (confirm(message)) {
            onConfirm();
        }
        return;
    }
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    // Retirer les anciens listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    // Ajouter le nouveau listener
    newConfirmBtn.addEventListener('click', () => {
        closeConfirmModal();
        onConfirm();
    });
    
    openModal('confirmModal');
}

// ====== APPELS API ======

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
    
    if (method === 'GET') {
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
            
            if (method === 'GET' && useCache) {
                apiCache.set(endpoint, {
                    data: result,
                    timestamp: Date.now()
                });
                console.log('💾 Mise en cache:', endpoint);
            }
            
            if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
                clearCache();
            }
            
            return result;
            
        } catch (error) {
            console.error(`Tentative ${attempt + 1}/${retries + 1} échouée:`, error);
            
            if (attempt === retries) {
                showAlert(`Erreur API : ${error.message}`, 'error');
                throw error;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
    }
}

function clearCache() {
    apiCache.clear();
    console.log('🗑 Cache vidé');
}

async function checkApiHealth() {
    try {
        const healthUrl = API_BASE_URL.replace('/api/v1', '/api/v1/health');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const health = await fetch(healthUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await health.json();
        console.log('✅ API Health:', data);
        
        return data.status === 'healthy' && data.database === 'connected';
    } catch (error) {
        console.error('❌ API Health check failed:', error);
        return false;
    }
}

// ====== STATS RAPIDES POUR LE FOOTER ======

async function getQuickStats() {
    try {
        const statsResponse = await callApi('/stats', 'GET', null, true, true);
        const loansResponse = await callApi('/loans?status=active', 'GET', null, true, true);
        
        return {
            total: statsResponse.collection?.total || 0,
            loans: loansResponse.loans?.length || 0
        };
    } catch (error) {
        console.error('Erreur stats:', error);
        return { total: 0, loans: 0 };
    }
}

// ====== NOTIFICATIONS DES PRÊTS EN RETARD ======

async function checkOverdueLoans() {
    try {
        const response = await callApi('/loans?status=overdue', 'GET', null, true, false);
        const overdueLoans = response.loans || [];
        
        const badge = document.getElementById('notificationBadge');
        const btn = document.getElementById('notificationsBtn');
        
        if (!badge || !btn) return;
        
        if (overdueLoans.length > 0) {
            badge.textContent = overdueLoans.length;
            badge.style.display = 'block';
            btn.style.display = 'block';
            
            btn.onclick = () => {
                showAlert(`⚠ ${overdueLoans.length} prêt(s) en retard !`, 'warning', 3000);
                showPage('loans');
            };
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        console.error('Erreur vérification prêts en retard:', error);
    }
}

// ====== AUTOCOMPLÉTION ======

let autocompleteTimeout = null;
let autocompleteContainer = null;

function initAutocomplete(inputId, onSelect) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    // Créer le conteneur d'autocomplétion
    autocompleteContainer = document.createElement('div');
    autocompleteContainer.className = 'autocomplete-suggestions';
    input.parentNode.appendChild(autocompleteContainer);
    
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        clearTimeout(autocompleteTimeout);
        
        if (query.length < 2) {
            autocompleteContainer.innerHTML = '';
            autocompleteContainer.style.display = 'none';
            return;
        }
        
        const delay = typeof API_CONFIG !== 'undefined' && API_CONFIG.AUTOCOMPLETE_DELAY 
            ? API_CONFIG.AUTOCOMPLETE_DELAY 
            : 300;
        
        autocompleteTimeout = setTimeout(async () => {
            try {
                const response = await callApi(`/search/autocomplete?q=${encodeURIComponent(query)}`, 'GET', null, true, true);
                displayAutocompleteSuggestions(response.suggestions, onSelect);
            } catch (error) {
                console.error('Erreur autocomplétion:', error);
            }
        }, delay);
    });
    
    // Fermer l'autocomplétion si on clique ailleurs
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !autocompleteContainer.contains(e.target)) {
            autocompleteContainer.style.display = 'none';
        }
    });
}

function displayAutocompleteSuggestions(suggestions, onSelect) {
    if (!suggestions || suggestions.length === 0) {
        autocompleteContainer.innerHTML = '<div class="autocomplete-item">Aucun résultat</div>';
        autocompleteContainer.style.display = 'block';
        return;
    }
    
    autocompleteContainer.innerHTML = suggestions.map(book => `
        <div class="autocomplete-item" data-book-id="${book.id}">
            <div class="autocomplete-title">${escapeHtml(book.titre)}</div>
            <div class="autocomplete-author">${escapeHtml(book.auteur)} • ${book.proprietaire}</div>
            <div class="autocomplete-type">${book.est_wishlist ? '💖 Wishlist' : '📚 Collection'}</div>
        </div>
    `).join('');
    
    autocompleteContainer.style.display = 'block';
    
    // Ajouter les événements de clic
    autocompleteContainer.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
            const bookId = item.dataset.bookId;
            const book = suggestions.find(b => b.id == bookId);
            if (onSelect && book) {
                onSelect(book);
            }
            autocompleteContainer.style.display = 'none';
        });
    });
}

// ====== SYSTÈME DE ROUTAGE/PAGES ======

const pages = {
    'home': renderHomePage,
    'collection': renderBookListPage,
    'wishlist': renderBookListPage,
    'addBook': renderAddEditBookForm,
    'tags': renderTagsPage,
    'loans': renderLoansPage,
    'recommendations': renderRecommendationsPage,
    'users': renderUsersPage,
    'login': renderLoginPage
};

function showPage(pageName, data = {}) {
    if (!currentApiKey && pageName !== 'login') {
        renderLoginPage();
        return;
    }
    
    currentPage = 1;
    
    document.querySelectorAll('#mainNav button').forEach(btn => btn.classList.remove('active'));
    const currentButton = document.getElementById(`${pageName}Btn`);
    if (currentButton) {
        currentButton.classList.add('active');
    }

    if (pages[pageName]) {
        pages[pageName](data);
    } else {
        appContainer.innerHTML = '<h2>Page non trouvée</h2><p>La page demandée n\'existe pas.</p>';
    }
}

// ====== NAVIGATION ======

function renderNavigation() {
    mainNav.innerHTML = `
        <div class="nav-left">
            <button id="homeBtn"><i class="fas fa-home"></i> Accueil</button>
            <button id="collectionBtn"><i class="fas fa-book"></i> Collection</button>
            <button id="wishlistBtn"><i class="fas fa-heart"></i> Wishlist</button>
            <button id="loansBtn"><i class="fas fa-handshake"></i> Prêts</button>
            <button id="recommendationsBtn"><i class="fas fa-magic"></i> Suggestions</button>
            <button id="tagsBtn"><i class="fas fa-tags"></i> Tags</button>
            <button id="usersBtn"><i class="fas fa-users"></i> Utilisateurs</button>
        </div>
        <div class="nav-right">
            <button id="addBookBtn" class="btn-primary"><i class="fas fa-plus"></i> Ajouter</button>
            <button id="logoutBtn" class="icon-btn" title="Déconnexion">
                <i class="fas fa-sign-out-alt"></i>
            </button>
        </div>
    `;

    document.getElementById('homeBtn').addEventListener('click', () => showPage('home'));
    document.getElementById('collectionBtn').addEventListener('click', () => showPage('collection', { isWishlist: false }));
    document.getElementById('wishlistBtn').addEventListener('click', () => showPage('wishlist', { isWishlist: true }));
    document.getElementById('loansBtn').addEventListener('click', () => showPage('loans'));
    document.getElementById('recommendationsBtn').addEventListener('click', () => showPage('recommendations'));
    document.getElementById('tagsBtn').addEventListener('click', () => showPage('tags'));
    document.getElementById('usersBtn').addEventListener('click', () => showPage('users'));
    document.getElementById('addBookBtn').addEventListener('click', () => openAddBookModal());
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Vérifier les prêts en retard
    checkOverdueLoans();
    setInterval(checkOverdueLoans, 300000); // Toutes les 5 minutes
    
    // Afficher le bouton profil
    const profileBtn = document.getElementById('userProfileBtn');
    if (profileBtn) {
        profileBtn.style.display = 'block';
        profileBtn.onclick = () => showPage('users');
    }
}

// ====== PAGE DE CONNEXION ======

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
    
    checkApiHealth().then(isHealthy => {
        const statusDiv = document.getElementById('apiStatus');
        if (isHealthy) {
            statusDiv.innerHTML = '<p style="color: green;">✅ API connectée (PostgreSQL)</p>';
        } else {
            statusDiv.innerHTML = '<p style="color: orange;">⚠ L\'API semble indisponible.</p>';
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
        
        // Charger les préférences utilisateur
        try {
            const prefs = await callApi(`/users/${currentUserId}/preferences`, 'GET', null, true, false);
            if (prefs.dark_mode) {
                document.body.classList.add('dark-mode');
                document.body.classList.remove('light-mode');
                localStorage.setItem(DARK_MODE_KEY, 'true');
            }
        } catch (error) {
            console.warn('Impossible de charger les préférences:', error);
        }
        
        hideLoader();
        showToast('Connexion réussie !', 'success');
        renderNavigation();
        showPage('home');
    } catch (error) {
        hideLoader();
    }
}

function logout() {
    currentApiKey = null;
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    clearCache();
    showToast('Vous avez été déconnecté.', 'info');
    showPage('login');
}

// ====== PAGE D'ACCUEIL ======

async function renderHomePage() {
    appContainer.innerHTML = `
        <div class="homepage">
            <h2>📚 Bienvenue dans votre Bibliothèque !</h2>
            <p class="tagline">Organisez, découvrez, et partagez vos lectures préférées.</p>
            
            <div class="quick-search">
                <h3>🔍 Recherche rapide</h3>
                <div style="position: relative;">
                    <input 
                        type="text" 
                        id="quickSearch" 
                        placeholder="Rechercher un livre par titre ou auteur..."
                        class="search-input-large"
                    >
                </div>
            </div>
            
            <div id="homeStats" class="welcome-stats">
                <div class="spinner"></div>
                <p>Chargement des statistiques...</p>
            </div>
        </div>
    `;
    
    // Initialiser l'autocomplétion
    initAutocomplete('quickSearch', (book) => {
        if (book.est_wishlist) {
            editBookInModal(book.id, true);
        } else {
            editBookInModal(book.id, false);
        }
    });
    
    console.time('Chargement stats');
    
    try {
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
                <h4>Livres de Jérémy</h4>
                <p class="stat-number">${(collectionStats.mes_livres || 0) + (wishlistStats.mes_souhaits || 0)}</p>
                <small>au total</small>
            </div>
            <div class="stat-card">
                <i class="fas fa-user-friends icon"></i>
                <h4>Livres de Kelly</h4>
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

// ====== PAGE DE LISTE DE LIVRES AVEC PAGINATION ET TAGS ======

// ====== PAGE DE LISTE DE LIVRES AVEC PAGINATION ET TAGS ======

async function renderBookListPage(data) {
    const isWishlist = data.isWishlist;
    const pageTitle = isWishlist ? '💖 Ma Wishlist' : '📚 Ma Collection de Livres';

    console.log('🔍 Rendering book list page, isWishlist:', isWishlist);

    appContainer.innerHTML = `
        <h2>${pageTitle}</h2>
        <div class="filter-sort-section">
            <div style="position: relative; flex: 2;">
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
                    <option value="J">Jérémy</option>
                    <option value="K">Kelly</option>
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

    const applyFiltersBtn = document.getElementById('applyFiltersBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const itemsPerPageSelect = document.getElementById('itemsPerPageSelect');
    const searchQuery = document.getElementById('searchQuery');

    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', () => {
            console.log('🔍 Applying filters');
            currentPage = 1;
            fetchAndRenderBooks(isWishlist);
        });
    }
    
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            console.log('🔄 Refreshing data');
            clearCache();
            fetchAndRenderBooks(isWishlist);
            showToast('Données actualisées !', 'info', 1500);
        });
    }
    
    if (itemsPerPageSelect) {
        itemsPerPageSelect.addEventListener('change', (e) => {
            itemsPerPage = parseInt(e.target.value);
            currentPage = 1;
            console.log('📄 Items per page changed to:', itemsPerPage);
            fetchAndRenderBooks(isWishlist);
        });
    }
    
    if (searchQuery) {
        searchQuery.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                currentPage = 1;
                console.log('🔍 Search triggered');
                fetchAndRenderBooks(isWishlist);
            }
        });
    }
    
    // Initialiser l'autocomplétion sur le champ de recherche
    initAutocomplete('searchQuery', (book) => {
        if (book.est_wishlist === (isWishlist ? 1 : 0)) {
            editBookInModal(book.id, isWishlist);
        } else {
            showToast('Ce livre est dans ' + (book.est_wishlist ? 'la wishlist' : 'la collection'), 'info');
        }
    });

    // Charger les livres immédiatement
    fetchAndRenderBooks(isWishlist);
}

async function fetchAndRenderBooks(isWishlist) {
    const bookListContent = document.getElementById('bookListContent');
    if (!bookListContent) {
        console.error('❌ bookListContent element not found');
        return;
    }
    
    bookListContent.innerHTML = '<div class="spinner"></div><p>Chargement des livres...</p>';

    const searchQueryInput = document.getElementById('searchQuery');
    const searchBySelect = document.getElementById('searchBy');
    const proprietaireFilterSelect = document.getElementById('proprietaireFilter');
    const statutFilterSelect = document.getElementById('statutFilter');

    const searchQuery = searchQueryInput ? searchQueryInput.value.trim() : '';
    const searchBy = searchBySelect ? searchBySelect.value : 'titre';
    const proprietaireFilter = isWishlist ? '' : (proprietaireFilterSelect ? proprietaireFilterSelect.value : '');
    const statutFilter = isWishlist ? '' : (statutFilterSelect ? statutFilterSelect.value : '');

    console.log('📚 Fetching books with filters:', {
        isWishlist,
        searchQuery,
        searchBy,
        proprietaireFilter,
        statutFilter,
        page: currentPage,
        perPage: itemsPerPage
    });

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
    
    queryString.append('sort_by', currentSortColumn);
    queryString.append('sort_dir', currentSortDirection);
    queryString.append('page', currentPage);
    queryString.append('per_page', itemsPerPage);

    const endpoint = isWishlist ? '/wishlist' : '/books';
    const fullEndpoint = `${endpoint}?${queryString.toString()}`;
    
    console.log('🌐 API Call:', fullEndpoint);
    console.time('⏱ Chargement livres');
    
    try {
        const response = await callApi(fullEndpoint, 'GET', null, true, false); // ✅ Désactiver le cache pour debug
        
        console.log('✅ API Response received:', response);
        
        let books = isWishlist ? response.wishlist_books : response.books;
        const stats = response.stats;

        console.timeEnd('⏱ Chargement livres');
        console.log('📊 Books count:', books ? books.length : 0);
        console.log('📊 Stats:', stats);
        
        totalItems = stats?.total || 0;
        totalPages = itemsPerPage >= 1000 ? 1 : Math.ceil(totalItems / itemsPerPage);
        
        renderPaginationInfo(books ? books.length : 0);
        
        let html = '';
        
        // Stats bar
        if (!isWishlist && stats) {
            html += `
                <div class="stats-bar">
                    <span><strong>${stats.total || 0}</strong> livres</span>
                    <span>📚 Jérémy: <strong>${stats.mes_livres || 0}</strong></span>
                    <span>📚 Kelly: <strong>${stats.livres_k || 0}</strong></span>
                    <span>📖 À lire: <strong>${stats.a_lire || 0}</strong></span>
                    <span>📚 En cours: <strong>${stats.en_cours || 0}</strong></span>
                    <span>✅ Lus: <strong>${stats.lus || 0}</strong></span>
                    ${stats.note_moyenne ? `<span>⭐ Moyenne: <strong>${stats.note_moyenne}/5</strong></span>` : ''}
                </div>
            `;
        } else if (isWishlist && stats) {
            html += `
                <div class="stats-bar">
                    <span><strong>${stats.total || 0}</strong> souhaits</span>
                    <span>💖 Jérémy: <strong>${stats.mes_souhaits || 0}</strong></span>
                    <span>💖 Kelly: <strong>${stats.souhaits_k || 0}</strong></span>
                </div>
            `;
        }

        if (!books || books.length === 0) {
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
                                ${!isWishlist ? '<th>Tags</th>' : ''}
                                <th class="actions-cell">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            books.forEach(book => {
                const noteStars = !isWishlist && book.note ? '⭐'.repeat(book.note) : '';
                const tags = book.tags || [];
                
                html += `
                    <tr>
                        <td class="book-title">${escapeHtml(book.titre)}</td>
                        <td>${escapeHtml(book.auteur)}</td>
                        <td><span class="badge">${escapeHtml(book.proprietaire)}</span></td>
                        ${!isWishlist ? `<td>${noteStars} ${book.note || 0}/5</td>` : ''}
                        ${!isWishlist ? `<td><span class="status-badge status-${book.statut_lecture}">${formatStatut(book.statut_lecture)}</span></td>` : ''}
                        ${!isWishlist ? `<td class="tags-cell">${tags.map(tag => `<span class="tag-mini">${escapeHtml(tag.name)}</span>`).join(' ')}</td>` : ''}
                        <td class="actions-cell">
                            <button class="btn-edit" onclick="editBookInModal(${book.id}, ${isWishlist})" title="Modifier">
                                <i class="fas fa-edit"></i>
                            </button>
                            ${isWishlist ? `
                            <button class="btn-move" onclick="moveToCollection(${book.id})" title="Vers la collection">
                                <i class="fas fa-arrow-right"></i>
                            </button>` : ''}
                            ${!isWishlist ? `
                            <button class="btn-loan" onclick="createLoanForBook(${book.id}, '${escapeHtml(book.titre).replace(/'/g, "\\'")}')">
                                <i class="fas fa-handshake"></i>
                            </button>` : ''}
                            <button class="btn-delete" onclick="deleteBookWithConfirm(${book.id}, ${isWishlist}, '${escapeHtml(book.titre).replace(/'/g, "\\'")}')">
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

        // Attacher les event listeners pour le tri
        const sortableHeaders = document.querySelectorAll('.book-table th.sortable');
        console.log('🔧 Attaching sort listeners to', sortableHeaders.length, 'headers');
        
        sortableHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                console.log('🔀 Sorting by', column);
                
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
        console.error('❌ Error fetching books:', error);
        console.timeEnd('⏱ Chargement livres');
        
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

function formatStatut(statut) {
    const statuts = {
        'a_lire': 'À lire',
        'en_cours': 'En cours',
        'lu': 'Lu'
    };
    return statuts[statut] || statut;
}

function getSortIcon(column) {
    if (currentSortColumn !== column) return '⇅';
    return currentSortDirection === 'asc' ? '↑' : '↓';
}

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
}

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

function goToPage(pageNum, isWishlist) {
    if (pageNum < 1 || pageNum > totalPages || pageNum === currentPage) return;
    currentPage = pageNum;
    fetchAndRenderBooks(isWishlist);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToPageInput(isWishlist) {
    const input = document.getElementById('gotoPage');
    const pageNum = parseInt(input.value);
    
    if (pageNum >= 1 && pageNum <= totalPages) {
        goToPage(pageNum, isWishlist);
    } else {
        showToast(`Veuillez entrer un numéro entre 1 et ${totalPages}`, 'error', 2000);
        input.value = currentPage;
    }
}

// ====== GESTION DES LIVRES AVEC MODAL ======

async function openAddBookModal(isWishlist = false) {
    // Charger les catégories
    await loadCategories();
    
    const bookForm = document.getElementById('bookForm');
    if (bookForm) {
        bookForm.reset();
    }
    
    const bookIdInput = document.getElementById('bookId');
    const bookModalTitle = document.getElementById('bookModalTitle');
    const bookNoteInput = document.getElementById('bookNote');
    const selectedTags = document.getElementById('selectedTags');
    const bookStatut = document.getElementById('bookStatut');
    
    if (bookIdInput) bookIdInput.value = '';
    if (bookModalTitle) bookModalTitle.textContent = 'Ajouter un nouveau livre';
    if (bookNoteInput) bookNoteInput.value = '0';
    if (selectedTags) selectedTags.innerHTML = '';
    if (bookStatut) bookStatut.value = isWishlist ? 'a_lire' : 'lu';
    
    // Réinitialiser l'affichage des étoiles
    updateStarDisplay(0);
    
    openModal('bookModal');
}

async function editBookInModal(bookId, isWishlist = false) {
    showLoader('Chargement du livre...');
    
    try {
        // Charger les catégories
        await loadCategories();
        
        const book = await callApi(isWishlist ? `/wishlist/${bookId}` : `/books/${bookId}`);
        
        const bookModalTitle = document.getElementById('bookModalTitle');
        const bookIdInput = document.getElementById('bookId');
        const bookTitreInput = document.getElementById('bookTitre');
        const bookAuteurInput = document.getElementById('bookAuteur');
        const bookNoteInput = document.getElementById('bookNote');
        const bookProprietaireSelect = document.getElementById('bookProprietaire');
        const bookStatutSelect = document.getElementById('bookStatut');
        const bookCategorySelect = document.getElementById('bookCategory');
        
        if (bookModalTitle) bookModalTitle.textContent = `Modifier : "${book.titre}"`;
        if (bookIdInput) bookIdInput.value = book.id;
        if (bookTitreInput) bookTitreInput.value = book.titre;
        if (bookAuteurInput) bookAuteurInput.value = book.auteur;
        if (bookNoteInput) bookNoteInput.value = book.note || 0;
        if (bookProprietaireSelect) bookProprietaireSelect.value = book.proprietaire;
        if (bookStatutSelect) bookStatutSelect.value = book.statut_lecture || 'lu';
        if (bookCategorySelect) bookCategorySelect.value = book.category_id || '';
        
        // Mettre à jour l'affichage des étoiles
        updateStarDisplay(book.note || 0);
        
        // Charger les tags
        const selectedTagsContainer = document.getElementById('selectedTags');
        if (selectedTagsContainer) {
            selectedTagsContainer.innerHTML = '';
            if (book.tags && book.tags.length > 0) {
                book.tags.forEach(tag => {
                    addTagToForm(tag.name);
                });
            }
        }
        
        hideLoader();
        openModal('bookModal');
    } catch (error) {
        hideLoader();
        showToast(`Erreur lors du chargement du livre: ${error.message}`, 'error');
    }
}

async function loadCategories() {
    try {
        const response = await callApi('/categories', 'GET', null, true, true);
        allCategories = response.categories || [];
        
        const categorySelect = document.getElementById('bookCategory');
        if (categorySelect) {
            categorySelect.innerHTML = '<option value="">Aucune</option>';
            allCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                categorySelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur chargement catégories:', error);
    }
}

function addTagToForm(tagName) {
    const selectedTags = document.getElementById('selectedTags');
    if (!selectedTags) return;
    
    // Vérifier si le tag existe déjà
    const existingTags = Array.from(selectedTags.querySelectorAll('.tag-item')).map(tag => tag.dataset.tagName);
    if (existingTags.includes(tagName)) {
        showToast('Ce tag est déjà ajouté', 'info', 1500);
        return;
    }
    
    const tagElement = document.createElement('span');
    tagElement.className = 'tag-item';
    tagElement.dataset.tagName = tagName;
    tagElement.innerHTML = `
        ${escapeHtml(tagName)}
        <button type="button" class="remove-tag" onclick="event.preventDefault(); this.parentElement.remove();">×</button>
    `;
    
    selectedTags.appendChild(tagElement);
}

function updateStarDisplay(rating, isHover = false) {
    const stars = document.querySelectorAll('#starRating i');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.className = 'fas fa-star';
        } else {
            star.className = 'far fa-star';
        }
    });
}

function updateCalculatedDueDate() {
    const durationInput = document.getElementById('loanDuration');
    const dueDateElement = document.getElementById('calculatedDueDate');
    
    if (!durationInput || !dueDateElement) return;
    
    const duration = parseInt(durationInput.value) || 14;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + duration);
    
    dueDateElement.textContent = dueDate.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

async function handleBookFormSubmit(e) {
    e.preventDefault();
    
    const bookIdInput = document.getElementById('bookId');
    const bookTitreInput = document.getElementById('bookTitre');
    const bookAuteurInput = document.getElementById('bookAuteur');
    const bookProprietaireSelect = document.getElementById('bookProprietaire');
    const bookNoteInput = document.getElementById('bookNote');
    const bookStatutSelect = document.getElementById('bookStatut');
    const bookCategorySelect = document.getElementById('bookCategory');
    
    if (!bookTitreInput || !bookAuteurInput) {
        showToast('Formulaire incomplet', 'error');
        return;
    }
    
    const bookId = bookIdInput ? bookIdInput.value : '';
    const isEditing = !!bookId;
    
    const bookData = {
        titre: bookTitreInput.value.trim(),
        auteur: bookAuteurInput.value.trim(),
        proprietaire: bookProprietaireSelect ? bookProprietaireSelect.value : 'J',
        note: bookNoteInput ? parseInt(bookNoteInput.value) || 0 : 0,
        statut_lecture: bookStatutSelect ? bookStatutSelect.value : 'lu',
        category_id: bookCategorySelect ? (parseInt(bookCategorySelect.value) || null) : null
    };
    
    // Récupérer les tags
    const tagElements = document.querySelectorAll('#selectedTags .tag-item');
    bookData.tags = Array.from(tagElements).map(tag => tag.dataset.tagName);
    
    showLoader(isEditing ? 'Modification en cours...' : 'Ajout en cours...');
    
    try {
        if (isEditing) {
            await callApi(`/books/${bookId}`, 'PUT', bookData);
            showToast('✅ Livre modifié avec succès !', 'success');
        } else {
            await callApi('/books', 'POST', bookData);
            showToast('✅ Livre ajouté avec succès !', 'success');
        }
        
        clearCache();
        closeBookModal();
        hideLoader();
        
        // Rafraîchir la page actuelle
        setTimeout(() => {
            showPage('collection', { isWishlist: false });
        }, 300);
    } catch (error) {
        hideLoader();
        console.error('Erreur formulaire livre:', error);
    }
}

async function deleteBookWithConfirm(bookId, isWishlist, titre) {
    showConfirmDialog(
        '⚠ Confirmer la suppression',
        `Êtes-vous sûr de vouloir supprimer "${titre}" ?`,
        async () => {
            showLoader('Suppression en cours...');
            
            try {
                const endpoint = isWishlist ? `/wishlist/${bookId}` : `/books/${bookId}`;
                const response = await callApi(endpoint, 'DELETE');
                clearCache();
                hideLoader();
                showToast(response.message, 'success');
                
                setTimeout(() => {
                    if (isWishlist) {
                        showPage('wishlist', { isWishlist: true });
                    } else {
                        showPage('collection', { isWishlist: false });
                    }
                }, 300);
            } catch (error) {
                hideLoader();
            }
        }
    );
}

async function moveToCollection(bookId) {
    showConfirmDialog(
        '📚 Déplacer vers la collection',
        'Voulez-vous déplacer ce livre vers votre collection ?',
        async () => {
            showLoader('Déplacement en cours...');
            
            try {
                const response = await callApi(`/wishlist/${bookId}/move_to_collection`, 'POST');
                clearCache();
                hideLoader();
                showToast(response.message, 'success');
                
                setTimeout(() => {
                    showPage('wishlist', { isWishlist: true });
                }, 300);
            } catch (error) {
                hideLoader();
            }
        }
    );
}

// ====== PAGE DES TAGS ======

async function renderTagsPage() {
    appContainer.innerHTML = `
        <h2>🏷 Gestion des Tags</h2>
        
        <div class="tags-manager">
            <div class="add-tag-section">
                <h3>Ajouter un nouveau tag</h3>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="newTagName" placeholder="Nom du tag" style="flex: 1;">
                    <button onclick="createNewTag()"><i class="fas fa-plus"></i> Ajouter</button>
                </div>
            </div>
            
            <div id="tagsListContent">
                <div class="spinner"></div>
                <p>Chargement des tags...</p>
            </div>
        </div>
    `;
    
    loadTagsList();
}

async function loadTagsList() {
    try {
        const response = await callApi('/tags', 'GET', null, true, false);
        const tags = response.tags || [];
        
        const tagsListContent = document.getElementById('tagsListContent');
        if (!tagsListContent) return;
        
        if (tags.length === 0) {
            tagsListContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-tags fa-3x"></i>
                    <p>Aucun tag disponible</p>
                </div>
            `;
        } else {
            tagsListContent.innerHTML = `
                <div class="tags-grid">
                    ${tags.map(tag => `
                        <div class="tag-card">
                            <span class="tag-name">${escapeHtml(tag.name)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
    } catch (error) {
        const tagsListContent = document.getElementById('tagsListContent');
        if (tagsListContent) {
            tagsListContent.innerHTML = `
                <div class="error-message">
                    <p>Erreur lors du chargement des tags</p>
                    <button onclick="loadTagsList()">Réessayer</button>
                </div>
            `;
        }
    }
}

async function createNewTag() {
    const input = document.getElementById('newTagName');
    if (!input) return;
    
    const tagName = input.value.trim().toLowerCase();
    
    if (!tagName) {
        showToast('Veuillez entrer un nom de tag', 'error');
        return;
    }
    
    try {
        await callApi('/tags', 'POST', { name: tagName });
        showToast('Tag créé avec succès !', 'success');
        input.value = '';
        loadTagsList();
    } catch (error) {
        // Erreur déjà gérée
    }
}

// ====== PAGE DES PRÊTS ======

async function renderLoansPage() {
    appContainer.innerHTML = `
        <h2>📖 Gestion des Prêts</h2>
        
        <div class="loans-filters">
            <select id="loanStatusFilter">
                <option value="">Tous les statuts</option>
                <option value="active">En cours</option>
                <option value="overdue">En retard</option>
                <option value="returned">Retournés</option>
            </select>
            <button onclick="loadLoans()"><i class="fas fa-filter"></i> Filtrer</button>
            <button onclick="loadLoans(true)" class="secondary-btn"><i class="fas fa-sync-alt"></i> Actualiser</button>
        </div>
        
        <div id="loansContent">
            <div class="spinner"></div>
            <p>Chargement des prêts...</p>
        </div>
    `;
    
    loadLoans();
}

async function loadLoans(forceRefresh = false) {
    const loansContent = document.getElementById('loansContent');
    if (!loansContent) return;
    
    loansContent.innerHTML = '<div class="spinner"></div><p>Chargement...</p>';
    
    const statusFilter = document.getElementById('loanStatusFilter')?.value || '';
    let endpoint = '/loans';
    if (statusFilter) {
        endpoint += `?status=${statusFilter}`;
    }
    
    try {
        const response = await callApi(endpoint, 'GET', null, true, !forceRefresh);
        const loans = response.loans || [];
        
        if (loans.length === 0) {
            loansContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-handshake fa-3x"></i>
                    <p>Aucun prêt ${statusFilter ? 'avec ce statut' : 'enregistré'}</p>
                </div>
            `;
        } else {
            let html = '<div class="loans-list">';
            
            loans.forEach(loan => {
                const isOverdue = loan.status === 'overdue';
                const isActive = loan.status === 'active';
                const statusClass = loan.status;
                const statusText = loan.status === 'active' ? 'En cours' : 
                                 loan.status === 'overdue' ? 'En retard' : 'Retourné';
                
                html += `
                    <div class="loan-card ${statusClass}">
                        <div class="loan-header">
                            <h3>${escapeHtml(loan.titre)}</h3>
                            <span class="loan-status-badge ${statusClass}">${statusText}</span>
                        </div>
                        <div class="loan-details">
                            <p><strong>Auteur:</strong> ${escapeHtml(loan.auteur)}</p>
                            <p><strong>Emprunté par:</strong> ${escapeHtml(loan.user_name)}</p>
                            <p><strong>Date d'emprunt:</strong> ${new Date(loan.loan_date).toLocaleDateString('fr-FR')}</p>
                            <p><strong>Date de retour prévue:</strong> ${new Date(loan.due_date).toLocaleDateString('fr-FR')}</p>
                            ${loan.return_date ? `<p><strong>Retourné le:</strong> ${new Date(loan.return_date).toLocaleDateString('fr-FR')}</p>` : ''}
                        </div>
                        ${(isActive || isOverdue) ? `
                        <div class="loan-actions">
                            <button onclick="returnLoanWithConfirm(${loan.id}, '${escapeHtml(loan.titre)}')" class="btn-success">
                                <i class="fas fa-check"></i> Marquer comme retourné
                            </button>
                            ${isActive ? `
                            <button onclick="extendLoan(${loan.id})" class="btn-info">
                                <i class="fas fa-clock"></i> Prolonger (7 jours)
                            </button>
                            ` : ''}
                        </div>
                        ` : ''}
                    </div>
                `;
            });
            
            html += '</div>';
            loansContent.innerHTML = html;
        }
    } catch (error) {
        loansContent.innerHTML = `
            <div class="error-message">
                <p>Erreur lors du chargement des prêts</p>
                <button onclick="loadLoans()">Réessayer</button>
            </div>
        `;
    }
}

async function createLoanForBook(bookId, titre) {
    const loanModalTitle = document.getElementById('loanModalTitle');
    const loanBookIdInput = document.getElementById('loanBookId');
    const loanDurationInput = document.getElementById('loanDuration');
    
    if (loanModalTitle) loanModalTitle.textContent = `Prêter : "${titre}"`;
    if (loanBookIdInput) loanBookIdInput.value = bookId;
    if (loanDurationInput) loanDurationInput.value = 14;
    
    // Charger les utilisateurs
    try {
        const response = await callApi('/users', 'GET', null, true, true);
        const users = response.users || [];
        
        const userSelect = document.getElementById('loanUser');
        if (userSelect) {
            userSelect.innerHTML = '<option value="">Sélectionner un utilisateur</option>';
            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.name;
                userSelect.appendChild(option);
            });
        }
        
        updateCalculatedDueDate();
        openModal('loanModal');
    } catch (error) {
        showToast('Erreur lors du chargement des utilisateurs', 'error');
    }
}

async function handleLoanFormSubmit(e) {
    e.preventDefault();
    
    const loanBookIdInput = document.getElementById('loanBookId');
    const loanUserSelect = document.getElementById('loanUser');
    const loanDurationInput = document.getElementById('loanDuration');
    
    if (!loanBookIdInput || !loanUserSelect || !loanDurationInput) {
        showToast('Formulaire incomplet', 'error');
        return;
    }
    
    const bookId = loanBookIdInput.value;
    const userId = loanUserSelect.value;
    const duration = loanDurationInput.value;
    
    if (!userId) {
        showToast('Veuillez sélectionner un utilisateur', 'error');
        return;
    }
    
    showLoader('Création du prêt...');
    
    try {
        await callApi('/loans', 'POST', {
            book_id: parseInt(bookId),
            user_id: parseInt(userId),
            loan_duration: parseInt(duration)
        });
        
        clearCache();
        hideLoader();
        closeLoanModal();
        showToast('Prêt créé avec succès !', 'success');
        checkOverdueLoans();
    } catch (error) {
        hideLoader();
        console.error('Erreur création prêt:', error);
    }
}

function showAddUserForm() {
    closeLoanModal();
    
    const userNameInput = document.getElementById('userName');
    const userEmailInput = document.getElementById('userEmail');
    
    if (userNameInput) userNameInput.value = '';
    if (userEmailInput) userEmailInput.value = '';
    
    openModal('userModal');
}

async function handleUserFormSubmit(e) {
    e.preventDefault();
    
    const userNameInput = document.getElementById('userName');
    const userEmailInput = document.getElementById('userEmail');
    
    if (!userNameInput) {
        showToast('Formulaire incomplet', 'error');
        return;
    }
    
    const name = userNameInput.value.trim();
    const email = userEmailInput ? userEmailInput.value.trim() : '';
    
    if (!name) {
        showToast('Veuillez entrer un nom', 'error');
        return;
    }
    
    try {
        await callApi('/users', 'POST', { name, email: email || null });
        showToast('Utilisateur créé avec succès !', 'success');
        closeUserModal();
        
        // Recharger la modal de prêt si elle était ouverte
        const loanBookIdInput = document.getElementById('loanBookId');
        if (loanBookIdInput && loanBookIdInput.value) {
            const loanModalTitle = document.getElementById('loanModalTitle');
            if (loanModalTitle) {
                const titre = loanModalTitle.textContent.replace('Prêter : "', '').replace('"', '');
                createLoanForBook(loanBookIdInput.value, titre);
            }
        }
    } catch (error) {
        console.error('Erreur création utilisateur:', error);
    }
}

async function returnLoanWithConfirm(loanId, titre) {
    showConfirmDialog(
        '📚 Retour de livre',
        `Marquer "${titre}" comme retourné ?`,
        async () => {
            try {
                showLoader('Mise à jour...');
                await callApi(`/loans/${loanId}/return`, 'PATCH');
                hideLoader();
                showToast('Livre retourné !', 'success');
                loadLoans();
                checkOverdueLoans();
            } catch (error) {
                hideLoader();
            }
        }
    );
}

async function extendLoan(loanId) {
    try {
        showLoader('Prolongation...');
        await callApi(`/loans/${loanId}/extend`, 'PATCH', { additional_days: 7 });
        hideLoader();
        showToast('Prêt prolongé de 7 jours !', 'success');
        loadLoans();
    } catch (error) {
        hideLoader();
    }
}

// ====== PAGE DES RECOMMANDATIONS ======

async function renderRecommendationsPage() {
    appContainer.innerHTML = `
        <h2>🎯 Recommandations pour vous</h2>
        <p class="subtitle">Basées sur vos lectures et vos goûts</p>
        
        <div id="recommendationsContent">
            <div class="spinner"></div>
            <p>Analyse de vos préférences...</p>
        </div>
    `;
    
    loadRecommendations();
}

async function loadRecommendations() {
    const recommendationsContent = document.getElementById('recommendationsContent');
    if (!recommendationsContent) return;
    
    try {
        const response = await callApi(`/recommendations/${currentUserId}?limit=10`, 'GET', null, true, true);
        const recommendations = response.recommendations || [];
        
        if (recommendations.length === 0) {
            recommendationsContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-magic fa-3x"></i>
                    <p>Pas encore assez de données pour générer des recommandations</p>
                    <small>Empruntez et notez des livres pour obtenir des suggestions personnalisées !</small>
                </div>
            `;
        } else {
            let html = '<div class="recommendations-grid">';
            
            recommendations.forEach(book => {
                html += `
                    <div class="recommendation-card">
                        <div class="recommendation-header">
                            <h3>${escapeHtml(book.titre)}</h3>
                            ${book.avg_rating ? `<span class="rating">⭐ ${book.avg_rating.toFixed(1)}</span>` : ''}
                        </div>
                        <p class="book-author">${escapeHtml(book.auteur)}</p>
                        <p class="book-owner">Propriétaire: ${book.proprietaire}</p>
                        ${book.matching_tags ? `<p class="matching-info">🏷 ${book.matching_tags} tags en commun</p>` : ''}
                        <div class="recommendation-actions">
                            <button onclick="editBookInModal(${book.id}, false)">
                                <i class="fas fa-info-circle"></i> Voir détails
                            </button>
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
            recommendationsContent.innerHTML = html;
        }
    } catch (error) {
        recommendationsContent.innerHTML = `
            <div class="error-message">
                <p>Erreur lors du chargement des recommandations</p>
                <button onclick="loadRecommendations()">Réessayer</button>
            </div>
        `;
    }
}

// ====== PAGE DES UTILISATEURS ======

async function renderUsersPage() {
    appContainer.innerHTML = `
        <h2>👥 Gestion des Utilisateurs</h2>
        
        <div class="users-manager">
            <div class="add-user-section">
                <h3>Ajouter un utilisateur</h3>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="newUserNamePage" placeholder="Nom" style="flex: 1;">
                    <input type="email" id="newUserEmailPage" placeholder="Email (optionnel)" style="flex: 1;">
                    <button onclick="createNewUserFromPage()"><i class="fas fa-plus"></i> Ajouter</button>
                </div>
            </div>
            
            <div id="usersListContent">
                <div class="spinner"></div>
                <p>Chargement des utilisateurs...</p>
            </div>
        </div>
    `;
    
    loadUsersList();
}

async function loadUsersList() {
    try {
        const response = await callApi('/users', 'GET', null, true, false);
        const users = response.users || [];
        
        const usersListContent = document.getElementById('usersListContent');
        if (!usersListContent) return;
        
        if (users.length === 0) {
            usersListContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users fa-3x"></i>
                    <p>Aucun utilisateur enregistré</p>
                </div>
            `;
        } else {
            usersListContent.innerHTML = `
                <div class="users-list">
                    ${users.map(user => `
                        <div class="user-card">
                            <div class="user-info">
                                <h3>${escapeHtml(user.name)}</h3>
                                ${user.email ? `<p>${escapeHtml(user.email)}</p>` : ''}
                                <small>Membre depuis: ${new Date(user.created_at).toLocaleDateString('fr-FR')}</small>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
    } catch (error) {
        const usersListContent = document.getElementById('usersListContent');
        if (usersListContent) {
            usersListContent.innerHTML = `
                <div class="error-message">
                    <p>Erreur lors du chargement des utilisateurs</p>
                    <button onclick="loadUsersList()">Réessayer</button>
                </div>
            `;
        }
    }
}

async function createNewUserFromPage() {
    const nameInput = document.getElementById('newUserNamePage');
    const emailInput = document.getElementById('newUserEmailPage');
    
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    const email = emailInput ? emailInput.value.trim() : '';
    
    if (!name) {
        showToast('Veuillez entrer un nom', 'error');
        return;
    }
    
    try {
        await callApi('/users', 'POST', { name, email: email || null });
        showToast('Utilisateur créé avec succès !', 'success');
        nameInput.value = '';
        if (emailInput) emailInput.value = '';
        loadUsersList();
    } catch (error) {
        // Erreur déjà gérée
    }
}

// ====== PAGE FICTIVE renderAddEditBookForm (pour compatibilité) ======
function renderAddEditBookForm(data = {}) {
    // Cette fonction existe pour la compatibilité avec le routeur
    // Elle redirige vers openAddBookModal
    if (data.bookId) {
        editBookInModal(data.bookId, data.isWishlist || false);
    } else {
        openAddBookModal(data.isWishlist || false);
    }
}

// ====== INITIALISATION PRINCIPALE ======

function initializeApp() {
    console.time('⏱ Initialisation totale');
    
    console.log('🔗 API URL:', API_BASE_URL);
    console.log('🔑 API Key présente:', !!currentApiKey);
    console.log('⏱ Cache duration:', CACHE_DURATION, 'ms');
    
    // Initialiser le mode sombre
    initDarkMode();
    
    // Initialiser les event listeners pour les formulaires
    initializeFormListeners();
    
    // Vérifier l'authentification et afficher la bonne page
    if (currentApiKey) {
        console.log('✅ Utilisateur authentifié');
        renderNavigation();
        showPage('home');
    } else {
        console.log('⚠ Pas d\'authentification, affichage du login');
        showPage('login');
    }
    
    console.timeEnd('⏱ Initialisation totale');
}

function initializeFormListeners() {
    // Note: Ces listeners seront attachés dynamiquement quand les modals seront créées
    // On les définit ici pour référence, mais l'attachement réel se fait dans les fonctions openModal
    
    console.log('✅ Form listeners initialisés (seront attachés dynamiquement)');
}

// ✅ Point d'entrée unique
document.addEventListener('DOMContentLoaded', () => {
    try {
        initializeApp();
        
        // Attacher les event listeners aux formulaires dans les modals
        setTimeout(() => {
            const bookForm = document.getElementById('bookForm');
            if (bookForm) {
                bookForm.addEventListener('submit', handleBookFormSubmit);
                console.log('✅ Book form listener attaché');
            }
            
            const loanForm = document.getElementById('loanForm');
            if (loanForm) {
                loanForm.addEventListener('submit', handleLoanFormSubmit);
                console.log('✅ Loan form listener attaché');
            }
            
            const userForm = document.getElementById('userForm');
            if (userForm) {
                userForm.addEventListener('submit', handleUserFormSubmit);
                console.log('✅ User form listener attaché');
            }
            
            // Event listeners pour les tags
            const newTagInput = document.getElementById('bookTags');
            if (newTagInput) {
                newTagInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const tagName = e.target.value.trim().toLowerCase();
                        if (tagName) {
                            addTagToForm(tagName);
                            e.target.value = '';
                        }
                    }
                });
                console.log('✅ Tags input listener attaché');
            }
            
            // Event listeners pour les étoiles
            const stars = document.querySelectorAll('#starRating i');
            const noteInput = document.getElementById('bookNote');
            
            if (stars.length > 0 && noteInput) {
                stars.forEach(star => {
                    star.addEventListener('click', () => {
                        const rating = parseInt(star.getAttribute('data-rating'));
                        noteInput.value = rating;
                        updateStarDisplay(rating);
                    });
                    
                    star.addEventListener('mouseenter', () => {
                        const rating = parseInt(star.getAttribute('data-rating'));
                        updateStarDisplay(rating, true);
                    });
                });
                
                const starRating = document.getElementById('starRating');
                if (starRating) {
                    starRating.addEventListener('mouseleave', () => {
                        updateStarDisplay(parseInt(noteInput.value));
                    });
                }
                
                console.log('✅ Star rating listeners attachés');
            }
            
            // Event listener pour la durée du prêt
            const loanDurationInput = document.getElementById('loanDuration');
            if (loanDurationInput) {
                loanDurationInput.addEventListener('input', updateCalculatedDueDate);
                console.log('✅ Loan duration listener attaché');
            }
        }, 500); // Attendre que les modals soient dans le DOM
        
    } catch (error) {
        console.error('❌ Erreur fatale lors de l\'initialisation:', error);
        if (appContainer) {
            appContainer.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle fa-3x"></i>
                    <h2>Erreur de chargement</h2>
                    <p>L'application n'a pas pu se charger correctement.</p>
                    <small>${error.message}</small>
                    <button onclick="location.reload()" style="margin-top: 20px;">
                        <i class="fas fa-redo"></i> Recharger la page
                    </button>
                </div>
            `;
        }
    }
});