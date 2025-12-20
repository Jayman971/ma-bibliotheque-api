# api_biblio.py - Version OPTIMISÉE pour déploiement sur Render.com avec PostgreSQL

from flask import Flask, request, jsonify
from functools import wraps
import psycopg
from psycopg.rows import dict_row
import os
from flask_cors import CORS
from datetime import datetime, timedelta

app = Flask(__name__)

# --- Configuration des clés secrètes via variables d'environnement ---
app.secret_key = os.environ.get('SECRET_KEY', 'CLE_SECRETE_POUR_API_FLASK_DEFAUT_EN_DEVELOPPEMENT_UNIQUEMENT_1234567890ABCDEF')

# --- Activer CORS pour toutes les routes ---
CORS(app) 

# --- Configuration de la base de données PostgreSQL ---
DATABASE_URL = os.environ.get('DATABASE_URL')

if not DATABASE_URL:
    raise ValueError("La variable d'environnement DATABASE_URL doit être définie pour se connecter à PostgreSQL")

# --- Configuration des identifiants ---
API_KEYS = {
    os.getenv('RENDER_API_KEY_ADMIN', 'mon_api_key_secrete_pour_admin_local'): 'admin',
    os.getenv('RENDER_API_KEY_ANDROID', 'api_key_pour_mon_app_android_local'): 'app_android_user'
}

USERS_PASSWORDS = {
    'admin': os.getenv('RENDER_ADMIN_PASSWORD', 'VotreMotDePasse123!'),
}

# ✅ Cache simple en mémoire (pour Render gratuit)
# Pour une vraie production, utilisez Redis
cache_store = {}
CACHE_DURATION = 30  # secondes

def get_from_cache(key):
    """Récupère une valeur du cache si elle n'est pas expirée"""
    if key in cache_store:
        data, timestamp = cache_store[key]
        if datetime.now() - timestamp < timedelta(seconds=CACHE_DURATION):
            return data
        else:
            del cache_store[key]  # Nettoie le cache expiré
    return None

def set_in_cache(key, value):
    """Met une valeur en cache avec un timestamp"""
    cache_store[key] = (value, datetime.now())

def clear_cache():
    """Vide tout le cache"""
    cache_store.clear()

# ====== SYSTÈME D'AUTHENTIFICATION API ======

def api_key_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'message': 'Authorization header is missing'}), 401

        try:
            scheme, api_key = auth_header.split(None, 1)
            if scheme.lower() != 'bearer':
                return jsonify({'message': 'Invalid authorization scheme. Use Bearer.'}), 401
        except ValueError:
            return jsonify({'message': 'Invalid Authorization header format. Expected "Bearer <api_key>"'}), 401

        if api_key not in API_KEYS:
            return jsonify({'message': 'Invalid API Key'}), 401
        
        request.current_user_api_key = api_key
        return f(*args, **kwargs)
    return decorated_function

@app.route('/api/v1/login', methods=['POST'])
def api_login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if username in USERS_PASSWORDS and USERS_PASSWORDS[username] == password:
        returned_api_key = next((key for key, value in API_KEYS.items() if value == 'admin' and username == 'admin'), None)
        if returned_api_key:
            return jsonify({'message': 'Login successful', 'api_key': returned_api_key}), 200
        else:
            return jsonify({'message': 'No API Key found for this user/configuration'}), 500
    else:
        return jsonify({'message': 'Invalid credentials'}), 401

# ====== BASE DE DONNÉES UTILITIES ======

def get_db_connection():
    """Établit une connexion à PostgreSQL avec psycopg3"""
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    return conn

def create_table():
    """Crée la table et les index si ils n'existent pas"""
    conn = get_db_connection()
    with conn.cursor() as cur:
        # ✅ Création de la table avec SERIAL pour l'auto-increment (PostgreSQL)
        cur.execute('''
            CREATE TABLE IF NOT EXISTS livres (
                id SERIAL PRIMARY KEY,
                titre TEXT NOT NULL,
                auteur TEXT NOT NULL,
                note INTEGER CHECK(note >= 0 AND note <= 5),
                proprietaire TEXT NOT NULL DEFAULT 'J',
                statut_lecture TEXT DEFAULT 'lu',
                est_wishlist INTEGER DEFAULT 0
            )
        ''')
        
        # ✅ Création d'index pour améliorer les performances
        cur.execute('CREATE INDEX IF NOT EXISTS idx_est_wishlist ON livres(est_wishlist)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_proprietaire ON livres(proprietaire)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_statut_lecture ON livres(statut_lecture)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_titre ON livres(titre)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_auteur ON livres(auteur)')
        
        conn.commit()
    conn.close()

create_table()

def get_book_by_id_helper(book_id, is_wishlist=None):
    """
    Récupère un livre spécifique par ID.
    """
    conn = get_db_connection()
    with conn.cursor() as cur:
        query = 'SELECT * FROM livres WHERE id = %s'
        params = [book_id]
        if is_wishlist is not None:
            query += ' AND est_wishlist = %s'
            params.append(1 if is_wishlist else 0)
        cur.execute(query, params)
        book = cur.fetchone()
    conn.close()
    return book if book else None

# ✅ Endpoint dédié aux statistiques (TRÈS RAPIDE)
@app.route('/api/v1/stats', methods=['GET'])
@api_key_required
def get_stats():
    """
    Endpoint optimisé pour récupérer uniquement les statistiques
    sans charger tous les livres
    """
    # Vérifier le cache
    cache_key = 'stats_global'
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return jsonify(cached_data), 200
    
    conn = get_db_connection()
    
    with conn.cursor() as cur:
        # ✅ Une seule requête optimisée pour les stats de la collection
        cur.execute('''
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN proprietaire = 'J' THEN 1 END) as mes_livres,
                COUNT(CASE WHEN proprietaire = 'K' THEN 1 END) as livres_k,
                COUNT(CASE WHEN statut_lecture = 'a_lire' THEN 1 END) as a_lire,
                COUNT(CASE WHEN statut_lecture = 'en_cours' THEN 1 END) as en_cours,
                COUNT(CASE WHEN statut_lecture = 'lu' THEN 1 END) as lus,
                ROUND(AVG(CASE WHEN note > 0 THEN note END), 1) as note_moyenne
            FROM livres
            WHERE est_wishlist = 0
        ''')
        stats_collection = cur.fetchone()
        
        # ✅ Une seule requête optimisée pour les stats de la wishlist
        cur.execute('''
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN proprietaire = 'J' THEN 1 END) as mes_souhaits,
                COUNT(CASE WHEN proprietaire = 'K' THEN 1 END) as souhaits_k
            FROM livres
            WHERE est_wishlist = 1
        ''')
        stats_wishlist = cur.fetchone()
    
    conn.close()
    
    result = {
        'collection': stats_collection,
        'wishlist': stats_wishlist
    }
    
    # Mettre en cache
    set_in_cache(cache_key, result)
    
    return jsonify(result), 200

# ====== ROUTES API POUR LES LIVRES (COLLECTION) ======

@app.route('/api/v1/books', methods=['GET'])
@api_key_required
def get_books():
    # ✅ Paramètres de recherche
    search_query = request.args.get('query', '').strip()
    search_by = request.args.get('search_by', 'titre')
    proprietaire_filter = request.args.get('proprietaire', '')
    statut_filter = request.args.get('statut', '')
    
    # ✅ Paramètres de tri
    sort_by = request.args.get('sort_by', 'titre')
    sort_dir = request.args.get('sort_dir', 'asc').upper()
    
    # ✅ Pagination (optionnel)
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 1000))  # Par défaut, tous les livres
    
    # Validation du tri
    allowed_sort_columns = ['titre', 'auteur', 'note', 'proprietaire', 'statut_lecture', 'id']
    if sort_by not in allowed_sort_columns:
        sort_by = 'titre'
    if sort_dir not in ['ASC', 'DESC']:
        sort_dir = 'ASC'
    
    # Construction de la clé de cache
    cache_key = f'books_{search_query}_{search_by}_{proprietaire_filter}_{statut_filter}_{sort_by}_{sort_dir}_{page}_{per_page}'
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return jsonify(cached_data), 200
    
    conn = get_db_connection()
    
    with conn.cursor() as cur:
        # ✅ Requête optimisée avec tri côté serveur
        sql_query = 'SELECT id, titre, auteur, note, proprietaire, statut_lecture, est_wishlist FROM livres WHERE est_wishlist = 0'
        params = []

        if search_query:
            if search_by == 'titre':
                sql_query += ' AND titre ILIKE %s'
            elif search_by == 'auteur':
                sql_query += ' AND auteur ILIKE %s'
            params.append(f'%{search_query}%')
        
        if proprietaire_filter:
            sql_query += ' AND proprietaire = %s'
            params.append(proprietaire_filter)
        
        if statut_filter:
            sql_query += ' AND statut_lecture = %s'
            params.append(statut_filter)
        
        # ✅ Tri côté serveur
        sql_query += f' ORDER BY {sort_by} {sort_dir}'
        
        # ✅ Pagination
        if per_page < 1000:  # Seulement si pagination activée
            offset = (page - 1) * per_page
            sql_query += f' LIMIT {per_page} OFFSET {offset}'
        
        cur.execute(sql_query, params)
        livres = cur.fetchall()
        
        # Stats (déjà optimisées)
        cur.execute('''
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN proprietaire = 'J' THEN 1 END) as mes_livres,
                COUNT(CASE WHEN proprietaire = 'K' THEN 1 END) as livres_k,
                COUNT(CASE WHEN statut_lecture = 'a_lire' THEN 1 END) as a_lire,
                COUNT(CASE WHEN statut_lecture = 'en_cours' THEN 1 END) as en_cours,
                COUNT(CASE WHEN statut_lecture = 'lu' THEN 1 END) as lus,
                ROUND(AVG(CASE WHEN note > 0 THEN note END), 1) as note_moyenne
            FROM livres
            WHERE est_wishlist = 0
        ''')
        stats = cur.fetchone() or {}
    
    conn.close()
    
    result = {
        'books': livres,
        'stats': stats
    }
    
    # Mettre en cache
    set_in_cache(cache_key, result)
    
    return jsonify(result), 200

@app.route('/api/v1/books/<int:book_id>', methods=['GET'])
@api_key_required
def get_book_by_id(book_id):
    # Vérifier le cache
    cache_key = f'book_{book_id}'
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return jsonify(cached_data), 200
    
    book = get_book_by_id_helper(book_id, is_wishlist=False)
    if book:
        set_in_cache(cache_key, book)
        return jsonify(book), 200
    else:
        return jsonify({'message': 'Livre non trouvé dans la collection'}), 404

@app.route('/api/v1/books', methods=['POST'])
@api_key_required
def add_book():
    data = request.get_json()
    
    titre = data.get('titre')
    auteur = data.get('auteur')
    note = int(data.get('note', 0))
    proprietaire = data.get('proprietaire', 'J')
    statut_lecture = data.get('statut_lecture', 'lu')
    est_wishlist = 0

    if not titre or not auteur:
        return jsonify({'message': 'Le titre et l\'auteur sont obligatoires'}), 400

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO livres (titre, auteur, note, proprietaire, statut_lecture, est_wishlist) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id',
                (titre, auteur, note, proprietaire, statut_lecture, est_wishlist)
            )
            new_book_id = cur.fetchone()['id']
            conn.commit()
        conn.close()
        
        # ✅ IMPORTANT : Vider le cache après modification
        clear_cache()
        
        return jsonify({'message': 'Livre ajouté à la collection avec succès !', 'id': new_book_id}), 201
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'message': f'Erreur lors de l\'ajout du livre: {str(e)}'}), 500

@app.route('/api/v1/books/<int:book_id>', methods=['PUT'])
@api_key_required
def update_book(book_id):
    book_exists = get_book_by_id_helper(book_id, is_wishlist=False)
    if not book_exists:
        return jsonify({'message': 'Livre non trouvé dans la collection'}), 404

    data = request.get_json()
    
    titre = data.get('titre')
    auteur = data.get('auteur')
    note = int(data.get('note', 0))
    proprietaire = data.get('proprietaire')
    statut_lecture = data.get('statut_lecture')
    
    if not titre or not auteur:
        return jsonify({'message': 'Le titre et l\'auteur sont obligatoires'}), 400

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE livres SET titre = %s, auteur = %s, note = %s, proprietaire = %s, statut_lecture = %s WHERE id = %s AND est_wishlist = 0',
                (titre, auteur, note, proprietaire, statut_lecture, book_id)
            )
            conn.commit()
        conn.close()
        
        # ✅ IMPORTANT : Vider le cache après modification
        clear_cache()
        
        return jsonify({'message': f'Le livre ID {book_id} a été mis à jour dans la collection !'}), 200
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'message': f'Erreur lors de la mise à jour du livre: {str(e)}'}), 500

@app.route('/api/v1/books/<int:book_id>', methods=['DELETE'])
@api_key_required
def delete_book(book_id):
    book_db = get_book_by_id_helper(book_id, is_wishlist=False)
    
    if book_db:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM livres WHERE id = %s AND est_wishlist = 0', (book_id,))
                conn.commit()
            conn.close()
            
            # ✅ IMPORTANT : Vider le cache après modification
            clear_cache()
            
            return jsonify({'message': f'Le livre "{book_db["titre"]}" a été supprimé de la collection.'}), 200
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify({'message': f'Erreur lors de la suppression du livre: {str(e)}'}), 500
    else:
        return jsonify({'message': 'Livre non trouvé dans la collection'}), 404

# ====== ROUTES API POUR LA WISHLIST ======

@app.route('/api/v1/wishlist', methods=['GET'])
@api_key_required
def get_wishlist():
    search_query = request.args.get('query', '').strip()
    search_by = request.args.get('search_by', 'titre')
    
    # ✅ Paramètres de tri
    sort_by = request.args.get('sort_by', 'titre')
    sort_dir = request.args.get('sort_dir', 'asc').upper()
    
    # Validation du tri
    allowed_sort_columns = ['titre', 'auteur', 'proprietaire', 'id']
    if sort_by not in allowed_sort_columns:
        sort_by = 'titre'
    if sort_dir not in ['ASC', 'DESC']:
        sort_dir = 'ASC'
    
    # Cache
    cache_key = f'wishlist_{search_query}_{search_by}_{sort_by}_{sort_dir}'
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return jsonify(cached_data), 200
    
    conn = get_db_connection()
    
    with conn.cursor() as cur:
        sql_query = 'SELECT id, titre, auteur, proprietaire FROM livres WHERE est_wishlist = 1'
        params = []
        
        if search_query:
            if search_by == 'titre':
                sql_query += ' AND titre ILIKE %s'
            elif search_by == 'auteur':
                sql_query += ' AND auteur ILIKE %s'
            params.append(f'%{search_query}%')
        
        # ✅ Tri côté serveur
        sql_query += f' ORDER BY {sort_by} {sort_dir}'
        
        cur.execute(sql_query, params)
        wishlist_livres = cur.fetchall()
        
        cur.execute('''
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN proprietaire = 'J' THEN 1 END) as mes_souhaits,
                COUNT(CASE WHEN proprietaire = 'K' THEN 1 END) as souhaits_k
            FROM livres
            WHERE est_wishlist = 1
        ''')
        stats_wishlist = cur.fetchone() or {}
    
    conn.close()
    
    result = {
        'wishlist_books': wishlist_livres,
        'stats': stats_wishlist
    }
    
    # Cache
    set_in_cache(cache_key, result)
    
    return jsonify(result), 200

@app.route('/api/v1/wishlist/<int:book_id>', methods=['GET'])
@api_key_required
def get_wishlist_book_by_id(book_id):
    # Cache
    cache_key = f'wishlist_book_{book_id}'
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return jsonify(cached_data), 200
    
    book = get_book_by_id_helper(book_id, is_wishlist=True)
    if book:
        set_in_cache(cache_key, book)
        return jsonify(book), 200
    else:
        return jsonify({'message': 'Livre non trouvé dans la wishlist'}), 404

@app.route('/api/v1/wishlist', methods=['POST'])
@api_key_required
def add_to_wishlist():
    data = request.get_json()
    
    titre = data.get('titre')
    auteur = data.get('auteur')
    proprietaire = data.get('proprietaire', 'J')
    est_wishlist = 1 

    if not titre or not auteur:
        return jsonify({'message': 'Le titre et l\'auteur sont obligatoires'}), 400

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO livres (titre, auteur, proprietaire, est_wishlist) VALUES (%s, %s, %s, %s) RETURNING id',
                (titre, auteur, proprietaire, est_wishlist)
            )
            new_book_id = cur.fetchone()['id']
            conn.commit()
        conn.close()
        
        # ✅ Vider le cache
        clear_cache()
        
        return jsonify({'message': 'Livre ajouté à la wishlist avec succès !', 'id': new_book_id}), 201
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'message': f'Erreur lors de l\'ajout à la wishlist: {str(e)}'}), 500

@app.route('/api/v1/wishlist/<int:book_id>', methods=['PUT'])
@api_key_required
def update_wishlist_book(book_id):
    book_exists = get_book_by_id_helper(book_id, is_wishlist=True)
    if not book_exists:
        return jsonify({'message': 'Livre non trouvé dans la wishlist'}), 404

    data = request.get_json()
    
    titre = data.get('titre')
    auteur = data.get('auteur')
    proprietaire = data.get('proprietaire')

    if not titre or not auteur:
        return jsonify({'message': 'Le titre et l\'auteur sont obligatoires'}), 400

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE livres SET titre = %s, auteur = %s, proprietaire = %s WHERE id = %s AND est_wishlist = 1',
                (titre, auteur, proprietaire, book_id)
            )
            conn.commit()
        conn.close()
        
        # ✅ Vider le cache
        clear_cache()
        
        return jsonify({'message': f'Le livre ID {book_id} a été mis à jour dans la wishlist !'}), 200
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'message': f'Erreur lors de la mise à jour du livre dans la wishlist: {str(e)}'}), 500

@app.route('/api/v1/wishlist/<int:book_id>', methods=['DELETE'])
@api_key_required
def delete_wishlist_book(book_id):
    book_db = get_book_by_id_helper(book_id, is_wishlist=True)
    
    if book_db:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM livres WHERE id = %s AND est_wishlist = 1', (book_id,))
                conn.commit()
            conn.close()
            
            # ✅ Vider le cache
            clear_cache()
            
            return jsonify({'message': f'Le livre "{book_db["titre"]}" a été supprimé de la wishlist.'}), 200
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify({'message': f'Erreur lors de la suppression du livre: {str(e)}'}), 500
    else:
        return jsonify({'message': 'Livre non trouvé dans la wishlist'}), 404

@app.route('/api/v1/wishlist/<int:book_id>/move_to_collection', methods=['POST'])
@api_key_required
def move_to_collection(book_id):
    book = get_book_by_id_helper(book_id, is_wishlist=True)
    
    if book:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    'UPDATE livres SET est_wishlist = 0, statut_lecture = %s WHERE id = %s', 
                    ('a_lire', book_id)
                )
                conn.commit()
            conn.close()
            
            # ✅ Vider le cache
            clear_cache()
            
            return jsonify({'message': f'Le livre "{book["titre"]}" a été ajouté à votre collection !'}), 200
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify({'message': f'Erreur lors du déplacement du livre: {str(e)}'}), 500
    else:
        return jsonify({'message': 'Livre non trouvé dans la wishlist'}), 404

# ✅ Endpoint pour vider manuellement le cache (utile pour le debug)
@app.route('/api/v1/cache/clear', methods=['POST'])
@api_key_required
def clear_cache_endpoint():
    clear_cache()
    return jsonify({'message': 'Cache vidé avec succès'}), 200

# ✅ Endpoint de santé (health check)
@app.route('/api/v1/health', methods=['GET'])
def health_check():
    """Endpoint pour vérifier que l'API fonctionne"""
    try:
        # Test de connexion à la base de données
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute('SELECT 1')
        conn.close()
        db_status = 'connected'
    except Exception as e:
        db_status = f'error: {str(e)}'
    
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'cache_size': len(cache_store),
        'database': db_status
    }), 200

# ====== GESTION DES ERREURS API ======
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Ressource non trouvée', 'error': str(error)}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Méthode non autorisée pour cette ressource', 'error': str(error)}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Erreur interne du serveur', 'error': str(error)}), 500

# ====== Point d'entrée pour l'exécution locale ======
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=int(os.getenv('PORT', '8081')))