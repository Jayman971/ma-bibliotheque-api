# api_biblio.py - Version NETTOYÉE sans tags, catégories ni recommandations

from flask import Flask, request, jsonify
from functools import wraps
import psycopg
from psycopg.rows import dict_row
import os
from flask_cors import CORS
from datetime import datetime, timedelta
from collections import Counter
import re

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

# ✅ Cache simple en mémoire
cache_store = {}
CACHE_DURATION = 30  # secondes

# ====== UTILITAIRE DE TRANSFORMATION J/K ======

def transform_jk_in_text(text):
    if not isinstance(text, str):
        return text
    text = re.sub(r'\bJ\b', 'Jérémy', text)
    text = re.sub(r'\bK\b', 'Kelly', text)
    return text

def transform_jk_in_dict(data):
    if isinstance(data, dict):
        return {key: transform_jk_in_dict(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [transform_jk_in_dict(item) for item in data]
    elif isinstance(data, str):
        return transform_jk_in_text(data)
    else:
        return data

def jsonify_with_transform(*args, **kwargs):
    if args:
        data = args[0]
    elif kwargs:
        data = kwargs
    else:
        data = {}
    transformed_data = transform_jk_in_dict(data)
    return jsonify(transformed_data)

# ====== CACHE UTILITIES ======

def get_from_cache(key):
    if key in cache_store:
        data, timestamp = cache_store[key]
        if datetime.now() - timestamp < timedelta(seconds=CACHE_DURATION):
            return data
        else:
            del cache_store[key]
    return None

def set_in_cache(key, value):
    cache_store[key] = (value, datetime.now())

def clear_cache():
    cache_store.clear()

# ====== SYSTÈME D'AUTHENTIFICATION API ======

def api_key_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify_with_transform({'message': 'Authorization header is missing'}), 401

        try:
            scheme, api_key = auth_header.split(None, 1)
            if scheme.lower() != 'bearer':
                return jsonify_with_transform({'message': 'Invalid authorization scheme. Use Bearer.'}), 401
        except ValueError:
            return jsonify_with_transform({'message': 'Invalid Authorization header format. Expected "Bearer <api_key>"'}), 401

        if api_key not in API_KEYS:
            return jsonify_with_transform({'message': 'Invalid API Key'}), 401
        
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
            return jsonify_with_transform({'message': 'Login successful', 'api_key': returned_api_key}), 200
        else:
            return jsonify_with_transform({'message': 'No API Key found for this user/configuration'}), 500
    else:
        return jsonify_with_transform({'message': 'Invalid credentials'}), 401

# ====== BASE DE DONNÉES UTILITIES ======

def get_db_connection():
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    return conn

def create_tables():
    conn = get_db_connection()
    with conn.cursor() as cur:
        # ✅ Ajout du champ lieu et annee_lecture
        cur.execute('''
            CREATE TABLE IF NOT EXISTS livres (
                id SERIAL PRIMARY KEY,
                titre TEXT NOT NULL,
                auteur TEXT NOT NULL,
                note INTEGER CHECK(note >= 0 AND note <= 5),
                proprietaire TEXT NOT NULL DEFAULT 'J',
                lieu TEXT DEFAULT 'J',
                statut_lecture TEXT DEFAULT 'lu',
                annee_lecture INTEGER,
                est_wishlist INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # ✅ Mise à jour de la table existante
        cur.execute("ALTER TABLE livres ADD COLUMN IF NOT EXISTS lieu TEXT DEFAULT 'J'")
        cur.execute("ALTER TABLE livres ADD COLUMN IF NOT EXISTS annee_lecture INTEGER")
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS loans (
                id SERIAL PRIMARY KEY,
                book_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                loan_date DATE NOT NULL,
                due_date DATE NOT NULL,
                return_date DATE,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'returned', 'overdue')),
                FOREIGN KEY (book_id) REFERENCES livres(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id INTEGER PRIMARY KEY,
                dark_mode BOOLEAN DEFAULT FALSE,
                language TEXT DEFAULT 'fr',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')
        
        cur.execute('CREATE INDEX IF NOT EXISTS idx_est_wishlist ON livres(est_wishlist)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_proprietaire ON livres(proprietaire)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_statut_lecture ON livres(statut_lecture)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_titre ON livres(titre)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_auteur ON livres(auteur)')
        
        cur.execute('CREATE INDEX IF NOT EXISTS idx_loan_status ON loans(status)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_loan_book_id ON loans(book_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_loan_user_id ON loans(user_id)')
        
        conn.commit()
    conn.close()

create_tables()

def get_book_by_id_helper(book_id, is_wishlist=None):
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

# ====== GESTION DES DOUBLONS (NOUVEAU) ======

@app.route('/api/v1/books/duplicates', methods=['GET'])
@api_key_required
def get_duplicates():
    """✅ Trouve les livres en double (insensible à la casse)"""
    conn = get_db_connection()
    doublons = []
    with conn.cursor() as cur:
        cur.execute('''
            SELECT LOWER(titre) as titre_lower, COUNT(*) as nb, ARRAY_AGG(id) as ids
            FROM livres
            WHERE est_wishlist = 0
            GROUP BY LOWER(titre)
            HAVING COUNT(*) > 1
        ''')
        results = cur.fetchall()
        
        for r in results:
            cur.execute('SELECT id, titre, auteur, proprietaire, lieu FROM livres WHERE id = ANY(%s)', (r['ids'],))
            books = cur.fetchall()
            doublons.append({
                'titre': books[0]['titre'],
                'livres': books
            })
    conn.close()
    return jsonify_with_transform({'doublons': doublons}), 200

# ====== AUTOCOMPLETE SEARCH ======

@app.route('/api/v1/search/autocomplete', methods=['GET'])
@api_key_required
def autocomplete_search():
    query = request.args.get('q', '').strip()
    if len(query) < 2:
        return jsonify_with_transform({'suggestions': []}), 200
    
    cache_key = f'autocomplete_{query}'
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return jsonify_with_transform(cached_data), 200
    
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute('''
            SELECT id, titre, auteur, proprietaire, est_wishlist
            FROM livres
            WHERE titre ILIKE %s OR auteur ILIKE %s
            ORDER BY titre ASC
            LIMIT 10
        ''', [f'%{query}%', f'%{query}%'])
        results = cur.fetchall()
    conn.close()
    
    response = {'suggestions': results}
    set_in_cache(cache_key, response)
    
    return jsonify_with_transform(response), 200

# ====== GESTION DES UTILISATEURS ======
# (Fonctions users inchangées)
@app.route('/api/v1/users', methods=['GET'])
@api_key_required
def get_users():
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute('SELECT id, name, email, created_at FROM users ORDER BY name ASC')
        users = cur.fetchall()
    conn.close()
    return jsonify_with_transform({'users': users}), 200

@app.route('/api/v1/users', methods=['POST'])
@api_key_required
def create_user():
    data = request.get_json()
    name = data.get('name')
    email = data.get('email')
    
    if not name:
        return jsonify_with_transform({'message': 'Le nom est obligatoire'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('INSERT INTO users (name, email) VALUES (%s, %s) RETURNING id', (name, email))
            new_user_id = cur.fetchone()['id']
            conn.commit()
        conn.close()
        return jsonify_with_transform({'message': 'Utilisateur créé avec succès', 'id': new_user_id}), 201
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify_with_transform({'message': f'Erreur: {str(e)}'}), 500

@app.route('/api/v1/users/<int:user_id>/preferences', methods=['GET', 'PUT'])
@api_key_required
def user_preferences(user_id):
    if request.method == 'GET':
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute('SELECT * FROM user_preferences WHERE user_id = %s', (user_id,))
            prefs = cur.fetchone()
            if not prefs:
                cur.execute('INSERT INTO user_preferences (user_id) VALUES (%s) RETURNING *', (user_id,))
                prefs = cur.fetchone()
                conn.commit()
        conn.close()
        return jsonify_with_transform(prefs), 200
    else:
        data = request.get_json()
        dark_mode = data.get('dark_mode')
        language = data.get('language')
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT user_id FROM user_preferences WHERE user_id = %s', (user_id,))
                exists = cur.fetchone()
                if exists:
                    updates, params = [], []
                    if dark_mode is not None: updates.append('dark_mode = %s'); params.append(dark_mode)
                    if language: updates.append('language = %s'); params.append(language)
                    if updates:
                        params.append(user_id)
                        cur.execute(f'UPDATE user_preferences SET {", ".join(updates)} WHERE user_id = %s', params)
                else:
                    cur.execute('INSERT INTO user_preferences (user_id, dark_mode, language) VALUES (%s, %s, %s)', (user_id, dark_mode, language))
                conn.commit()
            conn.close()
            return jsonify_with_transform({'message': 'Préférences mises à jour avec succès'}), 200
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify_with_transform({'message': f'Erreur: {str(e)}'}), 500

# ====== GESTION DES PRÊTS ======

@app.route('/api/v1/loans', methods=['GET'])
@api_key_required
def get_loans():
    status_filter = request.args.get('status')
    user_id = request.args.get('user_id')
    
    conn = get_db_connection()
    with conn.cursor() as cur:
        query = '''SELECT l.*, u.name as user_name, b.titre, b.auteur FROM loans l
                   JOIN users u ON l.user_id = u.id JOIN livres b ON l.book_id = b.id WHERE 1=1'''
        params = []
        if status_filter: query += ' AND l.status = %s'; params.append(status_filter)
        if user_id: query += ' AND l.user_id = %s'; params.append(user_id)
        query += ' ORDER BY l.loan_date DESC'
        
        cur.execute(query, params)
        loans = cur.fetchall()
        
        for loan in loans:
            if loan['status'] == 'active' and loan['due_date'] < datetime.now().date():
                cur.execute('UPDATE loans SET status = %s WHERE id = %s', ('overdue', loan['id']))
                loan['status'] = 'overdue'
        conn.commit()
    conn.close()
    return jsonify_with_transform({'loans': loans}), 200

@app.route('/api/v1/loans', methods=['POST'])
@api_key_required
def create_loan():
    data = request.get_json()
    book_id = data.get('book_id')
    user_id = data.get('user_id')
    loan_duration = data.get('loan_duration', 14)
    
    if not book_id or not user_id:
        return jsonify_with_transform({'message': 'book_id et user_id sont obligatoires'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT id FROM loans WHERE book_id = %s AND status = %s', (book_id, 'active'))
            if cur.fetchone():
                return jsonify_with_transform({'message': 'Ce livre est déjà emprunté'}), 400
            
            loan_date = datetime.now().date()
            due_date = loan_date + timedelta(days=loan_duration)
            
            cur.execute('''INSERT INTO loans (book_id, user_id, loan_date, due_date, status)
                           VALUES (%s, %s, %s, %s, %s) RETURNING id''', (book_id, user_id, loan_date, due_date, 'active'))
            new_loan_id = cur.fetchone()['id']
            
            # ✅ Met à jour le lieu du livre
            cur.execute('UPDATE livres SET lieu = %s WHERE id = %s', ('Prete', book_id))
            
            conn.commit()
        conn.close()
        clear_cache()
        return jsonify_with_transform({'message': 'Prêt créé avec succès', 'id': new_loan_id, 'due_date': due_date.isoformat()}), 201
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify_with_transform({'message': f'Erreur: {str(e)}'}), 500

@app.route('/api/v1/loans/<int:loan_id>/return', methods=['PATCH'])
@api_key_required
def return_loan(loan_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('UPDATE loans SET return_date = %s, status = %s WHERE id = %s AND status IN (%s, %s) RETURNING book_id',
                        (datetime.now().date(), 'returned', loan_id, 'active', 'overdue'))
            returned_loan = cur.fetchone()
            
            if not returned_loan:
                return jsonify_with_transform({'message': 'Prêt non trouvé ou déjà retourné'}), 404
            
            # ✅ Remet le livre chez son propriétaire
            cur.execute('UPDATE livres SET lieu = proprietaire WHERE id = %s', (returned_loan['book_id'],))
            conn.commit()
        conn.close()
        clear_cache()
        return jsonify_with_transform({'message': 'Livre retourné avec succès'}), 200
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify_with_transform({'message': f'Erreur: {str(e)}'}), 500

@app.route('/api/v1/loans/<int:loan_id>/extend', methods=['PATCH'])
@api_key_required
def extend_loan(loan_id):
    data = request.get_json()
    additional_days = data.get('additional_days', 7)
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT due_date FROM loans WHERE id = %s AND status = %s', (loan_id, 'active'))
            loan = cur.fetchone()
            if not loan:
                return jsonify_with_transform({'message': 'Prêt non trouvé ou non actif'}), 404
            new_due_date = loan['due_date'] + timedelta(days=additional_days)
            cur.execute('UPDATE loans SET due_date = %s WHERE id = %s', (new_due_date, loan_id))
            conn.commit()
        conn.close()
        clear_cache()
        return jsonify_with_transform({'message': 'Prêt prolongé avec succès', 'new_due_date': new_due_date.isoformat()}), 200
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify_with_transform({'message': f'Erreur: {str(e)}'}), 500

# ====== ROUTES API POUR LES LIVRES (COLLECTION) ======

@app.route('/api/v1/stats', methods=['GET'])
@api_key_required
def get_stats():
    cache_key = 'stats_global'
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return jsonify_with_transform(cached_data), 200
    
    current_year = datetime.now().year
    conn = get_db_connection()
    
    with conn.cursor() as cur:
        # ✅ Ajout du comptage pour l'année en cours
        cur.execute('''
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN proprietaire = 'J' THEN 1 END) as mes_livres,
                COUNT(CASE WHEN proprietaire = 'K' THEN 1 END) as livres_k,
                COUNT(CASE WHEN statut_lecture = 'a_lire' THEN 1 END) as a_lire,
                COUNT(CASE WHEN statut_lecture = 'en_cours' THEN 1 END) as en_cours,
                COUNT(CASE WHEN statut_lecture = 'lu' THEN 1 END) as lus,
                COUNT(CASE WHEN statut_lecture = 'lu' AND annee_lecture = %s THEN 1 END) as lus_cette_annee,
                ROUND(AVG(CASE WHEN note > 0 THEN note END), 1) as note_moyenne
            FROM livres
            WHERE est_wishlist = 0
        ''', (current_year,))
        stats_collection = cur.fetchone()
        
        cur.execute('''
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN proprietaire = 'J' THEN 1 END) as mes_souhaits,
                   COUNT(CASE WHEN proprietaire = 'K' THEN 1 END) as souhaits_k
            FROM livres WHERE est_wishlist = 1
        ''')
        stats_wishlist = cur.fetchone()
    
    conn.close()
    result = {'collection': stats_collection, 'wishlist': stats_wishlist}
    set_in_cache(cache_key, result)
    return jsonify_with_transform(result), 200

@app.route('/api/v1/books', methods=['GET'])
@api_key_required
def get_books():
    search_query = request.args.get('query', '').strip()
    search_by = request.args.get('search_by', 'titre')
    proprietaire_filter = request.args.get('proprietaire', '')
    statut_filter = request.args.get('statut', '')
    sort_by = request.args.get('sort_by', 'titre')
    sort_dir = request.args.get('sort_dir', 'asc').upper()
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 1000))
    
    allowed_sort_columns = ['titre', 'auteur', 'note', 'proprietaire', 'lieu', 'statut_lecture', 'id']
    if sort_by not in allowed_sort_columns: sort_by = 'titre'
    if sort_dir not in ['ASC', 'DESC']: sort_dir = 'ASC'
    
    cache_key = f'books_{search_query}_{search_by}_{proprietaire_filter}_{statut_filter}_{sort_by}_{sort_dir}_{page}_{per_page}'
    cached_data = get_from_cache(cache_key)
    if cached_data: return jsonify_with_transform(cached_data), 200
    
    conn = get_db_connection()
    with conn.cursor() as cur:
        # ✅ On récupère le lieu
        sql_query = 'SELECT l.id, l.titre, l.auteur, l.note, l.proprietaire, l.lieu, l.statut_lecture, l.est_wishlist FROM livres l'
        params = []
        where_clauses = ['l.est_wishlist = 0']

        if search_query:
            if search_by == 'titre': where_clauses.append('l.titre ILIKE %s')
            elif search_by == 'auteur': where_clauses.append('l.auteur ILIKE %s')
            params.append(f'%{search_query}%')
        
        if proprietaire_filter:
            where_clauses.append('l.proprietaire = %s')
            params.append(proprietaire_filter)
        
        if statut_filter:
            where_clauses.append('l.statut_lecture = %s')
            params.append(statut_filter)
        
        sql_query += ' WHERE ' + ' AND '.join(where_clauses)
        sql_query += f' ORDER BY l.{sort_by} {sort_dir}'
        
        if per_page < 1000:
            offset = (page - 1) * per_page
            sql_query += f' LIMIT {per_page} OFFSET {offset}'
        
        cur.execute(sql_query, params)
        livres = cur.fetchall()
        
        cur.execute('''SELECT COUNT(*) as total, COUNT(CASE WHEN proprietaire = 'J' THEN 1 END) as mes_livres,
                       COUNT(CASE WHEN proprietaire = 'K' THEN 1 END) as livres_k, COUNT(CASE WHEN statut_lecture = 'a_lire' THEN 1 END) as a_lire,
                       COUNT(CASE WHEN statut_lecture = 'en_cours' THEN 1 END) as en_cours, COUNT(CASE WHEN statut_lecture = 'lu' THEN 1 END) as lus,
                       ROUND(AVG(CASE WHEN note > 0 THEN note END), 1) as note_moyenne FROM livres WHERE est_wishlist = 0''')
        stats = cur.fetchone() or {}
    conn.close()
    
    result = {'books': livres, 'stats': stats}
    set_in_cache(cache_key, result)
    return jsonify_with_transform(result), 200

@app.route('/api/v1/books/<int:book_id>', methods=['GET'])
@api_key_required
def get_book_by_id(book_id):
    cache_key = f'book_{book_id}'
    cached_data = get_from_cache(cache_key)
    if cached_data: return jsonify_with_transform(cached_data), 200
    
    book = get_book_by_id_helper(book_id, is_wishlist=False)
    if book:
        set_in_cache(cache_key, book)
        return jsonify_with_transform(book), 200
    else:
        return jsonify_with_transform({'message': 'Livre non trouvé'}), 404

@app.route('/api/v1/books', methods=['POST'])
@api_key_required
def add_book():
    data = request.get_json()
    titre = data.get('titre')
    auteur = data.get('auteur')
    note = int(data.get('note', 0))
    proprietaire = data.get('proprietaire', 'J')
    lieu = data.get('lieu', proprietaire) # ✅ Par défaut, le lieu est chez le propriétaire
    statut_lecture = data.get('statut_lecture', 'lu')
    annee_lecture = datetime.now().year if statut_lecture == 'lu' else None # ✅ Objectif annuel
    est_wishlist = 0

    if not titre or not auteur:
        return jsonify_with_transform({'message': 'Le titre et l\'auteur sont obligatoires'}), 400

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO livres (titre, auteur, note, proprietaire, lieu, statut_lecture, annee_lecture, est_wishlist) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id',
                (titre, auteur, note, proprietaire, lieu, statut_lecture, annee_lecture, est_wishlist)
            )
            new_book_id = cur.fetchone()['id']
            conn.commit()
        conn.close()
        clear_cache()
        return jsonify_with_transform({'message': 'Livre ajouté avec succès !', 'id': new_book_id}), 201
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify_with_transform({'message': f'Erreur: {str(e)}'}), 500

@app.route('/api/v1/books/<int:book_id>', methods=['PUT'])
@api_key_required
def update_book(book_id):
    book_exists = get_book_by_id_helper(book_id, is_wishlist=False)
    if not book_exists:
        return jsonify_with_transform({'message': 'Livre non trouvé'}), 404

    data = request.get_json()
    titre = data.get('titre')
    auteur = data.get('auteur')
    note = int(data.get('note', 0))
    proprietaire = data.get('proprietaire')
    lieu = data.get('lieu', proprietaire)
    statut_lecture = data.get('statut_lecture')
    
    # ✅ Met à jour l'année si on le passe en "lu"
    annee_lecture = book_exists.get('annee_lecture')
    if statut_lecture == 'lu' and book_exists.get('statut_lecture') != 'lu':
        annee_lecture = datetime.now().year

    if not titre or not auteur:
        return jsonify_with_transform({'message': 'Titre et auteur obligatoires'}), 400

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE livres SET titre = %s, auteur = %s, note = %s, proprietaire = %s, lieu = %s, statut_lecture = %s, annee_lecture = %s WHERE id = %s AND est_wishlist = 0',
                (titre, auteur, note, proprietaire, lieu, statut_lecture, annee_lecture, book_id)
            )
            conn.commit()
        conn.close()
        clear_cache()
        return jsonify_with_transform({'message': f'Le livre a été mis à jour !'}), 200
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify_with_transform({'message': f'Erreur: {str(e)}'}), 500

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
            clear_cache()
            return jsonify_with_transform({'message': f'Le livre "{book_db["titre"]}" a été supprimé.'}), 200
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify_with_transform({'message': f'Erreur: {str(e)}'}), 500
    else:
        return jsonify_with_transform({'message': 'Livre non trouvé'}), 404

# ====== ROUTES API POUR LA WISHLIST (inchangées structurellement, cache ignoré pour brièveté) ======
# (Ici sont restées tes routes wishlist existantes de base)
@app.route('/api/v1/wishlist', methods=['GET'])
@api_key_required
def get_wishlist():
    # ... même code que ton fichier original pour GET /wishlist
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute('SELECT id, titre, auteur, proprietaire FROM livres WHERE est_wishlist = 1 ORDER BY titre ASC')
        wishlist_livres = cur.fetchall()
    conn.close()
    return jsonify_with_transform({'wishlist_books': wishlist_livres, 'stats': {}}), 200

@app.route('/api/v1/wishlist', methods=['POST'])
@api_key_required
def add_to_wishlist():
    data = request.get_json()
    titre = data.get('titre')
    auteur = data.get('auteur')
    proprietaire = data.get('proprietaire', 'J')
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute('INSERT INTO livres (titre, auteur, proprietaire, est_wishlist) VALUES (%s, %s, %s, 1) RETURNING id', (titre, auteur, proprietaire))
        new_id = cur.fetchone()['id']
        conn.commit()
    conn.close()
    clear_cache()
    return jsonify_with_transform({'message': 'Ajouté à la wishlist !', 'id': new_id}), 201

@app.route('/api/v1/wishlist/<int:book_id>/move_to_collection', methods=['POST'])
@api_key_required
def move_to_collection(book_id):
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute('UPDATE livres SET est_wishlist = 0, statut_lecture = %s WHERE id = %s', ('a_lire', book_id))
        conn.commit()
    conn.close()
    clear_cache()
    return jsonify_with_transform({'message': 'Déplacé dans la collection !'}), 200

# ====== AUTRES ENDPOINTS ======
@app.route('/api/v1/cache/clear', methods=['POST'])
@api_key_required
def clear_cache_endpoint():
    clear_cache()
    return jsonify_with_transform({'message': 'Cache vidé'}), 200

@app.route('/api/v1/health', methods=['GET'])
def health_check():
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute('SELECT 1')
        conn.close()
        db_status = 'connected'
    except Exception as e:
        db_status = f'error: {str(e)}'
    return jsonify_with_transform({'status': 'healthy', 'database': db_status}), 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=int(os.getenv('PORT', '8081')))