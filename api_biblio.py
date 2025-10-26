# api_biblio.py - Version pour déploiement sur Render.com

from flask import Flask, request, jsonify
from functools import wraps
import sqlite3
import os
from flask_cors import CORS

app = Flask(__name__)

# --- Configuration des clés secrètes via variables d'environnement ---
# Pour la production, définissez SECRET_KEY sur Render. Pour les tests locaux, une valeur par défaut est utilisée.
app.secret_key = os.environ.get('SECRET_KEY', 'CLE_SECRETE_POUR_API_FLASK_DEFAUT_EN_DEVELOPPEMENT_UNIQUEMENT_1234567890ABCDEF')

# --- Activer CORS pour toutes les routes ---
# En production, vous pourriez vouloir restreindre les origines (origins) autorisées
CORS(app) 

# --- Configuration de la base de données ---
# Render.com conservera ma_bibliotheque1.db pour le plan gratuit,
# mais pour une production réelle, une base de données externe est recommandée.
DATABASE = 'ma_bibliotheque1.db'

# --- Configuration des identifiants (via variables d'environnement pour la production) ---
# Vous définirez RENDER_API_KEY_ADMIN et RENDER_API_KEY_ANDROID sur Render.
# Les valeurs par défaut sont pour le développement local.
API_KEYS = {
    os.getenv('RENDER_API_KEY_ADMIN', 'mon_api_key_secrete_pour_admin_local'): 'admin',
    os.getenv('RENDER_API_KEY_ANDROID', 'api_key_pour_mon_app_android_local'): 'app_android_user'
}

# Pour le mot de passe de l'utilisateur "admin", il est aussi lu depuis une variable d'environnement.
# Vous définirez RENDER_ADMIN_PASSWORD sur Render.
USERS_PASSWORDS = {
    'admin': os.getenv('RENDER_ADMIN_PASSWORD', 'VotreMotDePasse123!'),
}

# ====== SYSTÈME D'AUTHENTIFICATION API ======

def api_key_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'message': 'Authorization header is missing'}), 401 # Unauthorized

        try:
            scheme, api_key = auth_header.split(None, 1) # Sépare "Bearer" de la clé
            if scheme.lower() != 'bearer':
                return jsonify({'message': 'Invalid authorization scheme. Use Bearer.'}), 401
        except ValueError:
            return jsonify({'message': 'Invalid Authorization header format. Expected "Bearer <api_key>"'}), 401

        # Vérifie si la clé est valide en la recherchant dans les clés de notre dictionnaire
        if api_key not in API_KEYS:
            return jsonify({'message': 'Invalid API Key'}), 401
        
        request.current_user_api_key = api_key # Stocke la clé pour un usage potentiel dans la fonction
        return f(*args, **kwargs)
    return decorated_function

@app.route('/api/v1/login', methods=['POST'])
def api_login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if username in USERS_PASSWORDS and USERS_PASSWORDS[username] == password:
        # Renvoie la clé API correspondante à l'utilisateur "admin"
        # Pour d'autres utilisateurs, il faudrait une logique plus sophistiquée
        returned_api_key = next((key for key, value in API_KEYS.items() if value == 'admin' and username == 'admin'), None)
        if returned_api_key:
            return jsonify({'message': 'Login successful', 'api_key': returned_api_key}), 200
        else:
            return jsonify({'message': 'No API Key found for this user/configuration'}), 500
    else:
        return jsonify({'message': 'Invalid credentials'}), 401

# ====== BASE DE DONNÉES UTILITIES ======

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row # Permet d'accéder aux colonnes par leur nom
    return conn

def create_table():
    conn = get_db_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS livres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titre TEXT NOT NULL,
            auteur TEXT NOT NULL,
            note INTEGER CHECK(note >= 0 AND note <= 5),
            proprietaire TEXT NOT NULL DEFAULT 'J',
            statut_lecture TEXT DEFAULT 'lu',
            est_wishlist INTEGER DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()

create_table() # Assure que la table est créée au démarrage de l'application

def row_to_dict(row):
    """Convertit un objet sqlite3.Row en dictionnaire."""
    return dict(row)

def get_book_by_id_helper(book_id, is_wishlist=None):
    """
    Récupère un livre spécifique par ID, en spécifiant s'il doit être de la collection ou de la wishlist.
    is_wishlist=None: cherche indifféremment
    is_wishlist=False: cherche dans la collection
    is_wishlist=True: cherche dans la wishlist
    """
    conn = get_db_connection()
    query = 'SELECT * FROM livres WHERE id = ?'
    params = [book_id]
    if is_wishlist is not None:
        query += ' AND est_wishlist = ?'
        params.append(1 if is_wishlist else 0)
    book = conn.execute(query, params).fetchone()
    conn.close()
    return book if book else None

# ====== ROUTES API POUR LES LIVRES (COLLECTION) ======

@app.route('/api/v1/books', methods=['GET'])
@api_key_required
def get_books():
    conn = get_db_connection()
    
    search_query = request.args.get('query', '').strip()
    search_by = request.args.get('search_by', 'titre')
    proprietaire_filter = request.args.get('proprietaire', '')
    statut_filter = request.args.get('statut', '')

    sql_query = 'SELECT id, titre, auteur, note, proprietaire, statut_lecture, est_wishlist FROM livres WHERE est_wishlist = 0'
    params = []

    if search_query:
        if search_by == 'titre':
            sql_query += ' AND titre LIKE ?'
        elif search_by == 'auteur':
            sql_query += ' AND auteur LIKE ?'
        params.append(f'%{search_query}%')
    
    if proprietaire_filter:
        sql_query += ' AND proprietaire = ?'
        params.append(proprietaire_filter)
    
    if statut_filter:
        sql_query += ' AND statut_lecture = ?'
        params.append(statut_filter)
    
    sql_query += ' ORDER BY titre'

    livres_db = conn.execute(sql_query, params).fetchall()
    livres = [row_to_dict(row) for row in livres_db]
    
    stats_db = conn.execute('''
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
    ''').fetchone()
    stats = row_to_dict(stats_db) if stats_db else {}
    
    conn.close()
    
    return jsonify({
        'books': livres,
        'stats': stats
    }), 200

@app.route('/api/v1/books/<int:book_id>', methods=['GET'])
@api_key_required
def get_book_by_id(book_id):
    book = get_book_by_id_helper(book_id, is_wishlist=False) # Cherche spécifiquement dans la collection
    if book:
        return jsonify(row_to_dict(book)), 200
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
    est_wishlist = 0 # Pour la collection, est_wishlist est toujours 0

    if not titre or not auteur:
        return jsonify({'message': 'Le titre et l\'auteur sont obligatoires'}), 400

    conn = get_db_connection()
    try:
        cursor = conn.execute('INSERT INTO livres (titre, auteur, note, proprietaire, statut_lecture, est_wishlist) VALUES (?, ?, ?, ?, ?, ?)',
                     (titre, auteur, note, proprietaire, statut_lecture, est_wishlist))
        conn.commit()
        new_book_id = cursor.lastrowid
        conn.close()
        
        return jsonify({'message': 'Livre ajouté à la collection avec succès !', 'id': new_book_id}), 201 # Created
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
        conn.execute('UPDATE livres SET titre = ?, auteur = ?, note = ?, proprietaire = ?, statut_lecture = ? WHERE id = ? AND est_wishlist = 0',
                     (titre, auteur, note, proprietaire, statut_lecture, book_id))
        conn.commit()
        conn.close()
        
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
            conn.execute('DELETE FROM livres WHERE id = ? AND est_wishlist = 0', (book_id,))
            conn.commit()
            conn.close()
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
    conn = get_db_connection()
    
    search_query = request.args.get('query', '').strip()
    search_by = request.args.get('search_by', 'titre')
    
    sql_query = 'SELECT id, titre, auteur, proprietaire FROM livres WHERE est_wishlist = 1'
    params = []
    
    if search_query:
        if search_by == 'titre':
            sql_query += ' AND titre LIKE ?'
        elif search_by == 'auteur':
            sql_query += ' AND auteur LIKE ?'
        params.append(f'%{search_query}%')
    
    sql_query += ' ORDER BY titre'
    
    wishlist_livres_db = conn.execute(sql_query, params).fetchall()
    wishlist_livres = [row_to_dict(row) for row in wishlist_livres_db]
    
    stats_wishlist_db = conn.execute('''
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN proprietaire = 'J' THEN 1 END) as mes_souhaits,
            COUNT(CASE WHEN proprietaire = 'K' THEN 1 END) as souhaits_k
        FROM livres
        WHERE est_wishlist = 1
    ''').fetchone()
    stats_wishlist = row_to_dict(stats_wishlist_db) if stats_wishlist_db else {}
    
    conn.close()
    
    return jsonify({
        'wishlist_books': wishlist_livres,
        'stats': stats_wishlist
    }), 200

@app.route('/api/v1/wishlist/<int:book_id>', methods=['GET'])
@api_key_required
def get_wishlist_book_by_id(book_id):
    book = get_book_by_id_helper(book_id, is_wishlist=True) # Cherche spécifiquement dans la wishlist
    if book:
        return jsonify(row_to_dict(book)), 200
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
        cursor = conn.execute('INSERT INTO livres (titre, auteur, proprietaire, est_wishlist) VALUES (?, ?, ?, ?)',
                     (titre, auteur, proprietaire, est_wishlist))
        conn.commit()
        new_book_id = cursor.lastrowid
        conn.close()
        
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
        conn.execute('UPDATE livres SET titre = ?, auteur = ?, proprietaire = ? WHERE id = ? AND est_wishlist = 1',
                     (titre, auteur, proprietaire, book_id))
        conn.commit()
        conn.close()
        
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
            conn.execute('DELETE FROM livres WHERE id = ? AND est_wishlist = 1', (book_id,))
            conn.commit()
            conn.close()
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
            conn.execute('UPDATE livres SET est_wishlist = 0, statut_lecture = ? WHERE id = ?', 
                         ('a_lire', book_id))
            conn.commit()
            conn.close()
            return jsonify({'message': f'Le livre "{book["titre"]}" a été ajouté à votre collection !'}), 200
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify({'message': f'Erreur lors du déplacement du livre: {str(e)}'}), 500
    else:
        return jsonify({'message': 'Livre non trouvé dans la wishlist'}), 404

# ====== GESTION DES ERREURS API ======
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Ressource non trouvée', 'error': str(error)}), 404

@app.errorhandler(405) # Méthode non autorisée
def method_not_allowed(error):
    return jsonify({'message': 'Méthode non autorisée pour cette ressource', 'error': str(error)}), 405

@app.errorhandler(500)
def internal_error(error):
    # En production, évitez de donner trop de détails sur l'erreur
    return jsonify({'message': 'Erreur interne du serveur', 'error': str(error)}), 500

# ====== Point d'entrée pour l'exécution locale (développement) ======
# En production, Gunicorn (via Procfile) s'occupera de démarrer l'application.
if __name__ == '__main__':
    # Le port est lu depuis la variable d'environnement PORT si elle existe (utilisé par Render),
    # sinon, il utilise 8081 pour les tests locaux.
    app.run(debug=True, host='0.0.0.0', port=os.getenv('PORT', '8081'))