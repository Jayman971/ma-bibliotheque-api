package com.ma.bibliotheque

import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

// Imports de vos classes définies dans ApiService.kt
import com.ma.bibliotheque.LoginRequest
import com.ma.bibliotheque.RetrofitClient
import com.ma.bibliotheque.Book


class MainActivity : AppCompatActivity() {

    private val TAG = "MainActivity" // Tag pour les logs

    // Variable pour stocker temporairement l'API Key après le login
    private var currentApiKey: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Cette ligne fait référence à votre fichier XML de layout.
        // Le template Empty Views Activity devrait avoir créé res/layout/activity_main.xml
        setContentView(R.layout.activity_main)

        // Nous allons lancer la logique de connexion et de récupération des livres
        // dans une coroutine pour ne pas bloquer le thread principal (UI).
        // lifecycleScope.launch assure que la coroutine est liée au cycle de vie de l'activité.
        lifecycleScope.launch {
            // Étape 1: Tenter de se connecter à l'API
            // REMPLACEZ "admin" ET "VotreMotDePasse123!" PAR VOS VRAIS IDENTIFIANTS DE L'API FLASK
            val loginRequest = LoginRequest("admin", "VotreMotDePasse123!")

            try {
                // Appel API pour le login
                val response = RetrofitClient.instance.login(loginRequest)

                if (response.isSuccessful) {
                    val loginResponse = response.body()
                    currentApiKey = loginResponse?.api_key // Stocke la clé API

                    Log.d(TAG, "Login réussi: ${loginResponse?.message}, API Key: $currentApiKey")

                    // Étape 2: Si le login est réussi et que nous avons une clé API, récupérer les livres
                    currentApiKey?.let { apiKey ->
                        fetchCollectionBooks(apiKey) // Appel de la fonction pour récupérer les livres de la collection
                        fetchWishlistBooks(apiKey) // Appel de la fonction pour récupérer les livres de la wishlist
                    } ?: run {
                        Log.e(TAG, "Login réussi mais API Key est nulle.")
                    }

                } else {
                    val errorBody = response.errorBody()?.string()
                    Log.e(TAG, "Login échoué: Code HTTP ${response.code()}, Erreur: $errorBody")
                }
            } catch (e: Exception) {
                // Capture toute exception réseau ou de parsing
                Log.e(TAG, "Erreur lors de l'appel de connexion: ${e.message}", e)
            }
        }
    }

    // Fonction pour récupérer les livres de la collection
    private suspend fun fetchCollectionBooks(apiKey: String) {
        try {
            // L'API attend l'API Key dans l'en-tête Authorization au format "Bearer VOTRE_CLE"
            val authHeader = "Bearer $apiKey"
            val response = RetrofitClient.instance.getCollectionBooks(authHeader)

            if (response.isSuccessful) {
                val booksResponse = response.body()
                Log.d(TAG, "--- Livres de la collection récupérés: ${booksResponse?.books?.size} livres ---")

                // Parcourt et affiche chaque livre récupéré
                booksResponse?.books?.forEach { book ->
                    Log.d(TAG, "Livre Collection ID: ${book.id}, Titre: ${book.titre}, Auteur: ${book.auteur}, Statut: ${book.statut_lecture}, Note: ${book.note}")
                }
                // Ici, plus tard, nous mettrons à jour l'interface utilisateur (UI)
                // pour afficher ces livres dans une liste par exemple.
            } else {
                val errorBody = response.errorBody()?.string()
                Log.e(TAG, "Erreur de récupération des livres de la collection: Code HTTP ${response.code()}, Erreur: $errorBody")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lors de la récupération des livres de la collection: ${e.message}", e)
        }
    }

    // Fonction pour récupérer les livres de la wishlist
    private suspend fun fetchWishlistBooks(apiKey: String) {
        try {
            val authHeader = "Bearer $apiKey"
            val response = RetrofitClient.instance.getWishlistBooks(authHeader)

            if (response.isSuccessful) {
                val wishlistResponse = response.body()
                Log.d(TAG, "--- Livres de la wishlist récupérés: ${wishlistResponse?.wishlist_books?.size} livres ---")

                wishlistResponse?.wishlist_books?.forEach { book ->
                    Log.d(TAG, "Livre Wishlist ID: ${book.id}, Titre: ${book.titre}, Auteur: ${book.auteur}, Propriétaire: ${book.proprietaire}")
                }
            } else {
                val errorBody = response.errorBody()?.string()
                Log.e(TAG, "Erreur de récupération des livres de la wishlist: Code HTTP ${response.code()}, Erreur: $errorBody")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lors de la récupération des livres de la wishlist: ${e.message}", e)
        }
    }
}