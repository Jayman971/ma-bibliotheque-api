

    package com.ma.bibliotheque // <<< VÉRIFIEZ QUE CELA CORRESPOND AU NOM DE VOTRE PACKAGE >>>

    import okhttp3.Interceptor
    import okhttp3.OkHttpClient
    import okhttp3.logging.HttpLoggingInterceptor
    import retrofit2.Response
    import retrofit2.Retrofit
    import retrofit2.converter.gson.GsonConverterFactory
    import retrofit2.http.Body
    import retrofit2.http.GET
    import retrofit2.http.Header
    import retrofit2.http.POST
    import retrofit2.http.PUT
    import retrofit2.http.DELETE
    import retrofit2.http.Path
    import retrofit2.http.Query // Ajouté pour les filtres si nécessaire

    // --- Modèles de données pour les requêtes et réponses de l'API ---

    // Modèles pour l'authentification
    data class LoginRequest(val username: String, val password: String)
    data class LoginResponse(val message: String, val api_key: String)

    // Modèle pour un livre
    data class Book(
        val id: Int? = null, // L'ID peut être nul pour un nouveau livre lors d'un POST
        val titre: String,
        val auteur: String,
        val note: Int? = null, // La note peut être nulle ou non applicable
        val proprietaire: String,
        val statut_lecture: String? = null, // Le statut peut être nul ou non applicable
        val est_wishlist: Int? = null // Peut être nul
    )

    // Modèle pour la réponse de la liste des livres/collection
    data class BooksResponse(
        val books: List<Book>,
        val stats: Map<String, Any> // Utilisez Map<String, Any> pour les statistiques flexibles
    )

    // Modèle pour la réponse de la wishlist
    data class WishlistResponse(
        val wishlist_books: List<Book>,
        val stats: Map<String, Any>
    )

    // Modèle pour les messages de réponse génériques (succès/erreur)
    data class MessageResponse(val message: String, val id: Int? = null)


    // --- Interface Retrofit définissant les endpoints de votre API ---
    interface ApiService {

        // Endpoint de connexion
        @POST("v1/login")
        suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

        // --- Endpoints pour la Collection (books) ---

        // Récupérer tous les livres de la collection (avec options de filtre si implémentées dans l'API Flask)
        @GET("v1/books")
        suspend fun getCollectionBooks(
            @Header("Authorization") authorization: String,
            @Query("query") query: String? = null,
            @Query("search_by") searchBy: String? = null,
            @Query("proprietaire") proprietaire: String? = null,
            @Query("statut") statut: String? = null
        ): Response<BooksResponse>

        // Récupérer un livre spécifique de la collection par ID
        @GET("v1/books/{book_id}")
        suspend fun getBookById(@Header("Authorization") authorization: String, @Path("book_id") bookId: Int): Response<Book>

        // Ajouter un livre à la collection
        @POST("v1/books")
        suspend fun addCollectionBook(@Header("Authorization") authorization: String, @Body book: Book): Response<MessageResponse>

        // Mettre à jour un livre de la collection
        @PUT("v1/books/{book_id}")
        suspend fun updateCollectionBook(@Header("Authorization") authorization: String, @Path("book_id") bookId: Int, @Body book: Book): Response<MessageResponse>

        // Supprimer un livre de la collection
        @DELETE("v1/books/{book_id}")
        suspend fun deleteCollectionBook(@Header("Authorization") authorization: String, @Path("book_id") bookId: Int): Response<MessageResponse>


        // --- Endpoints pour la Wishlist ---

        // Récupérer tous les livres de la wishlist
        @GET("v1/wishlist")
        suspend fun getWishlistBooks(
            @Header("Authorization") authorization: String,
            @Query("query") query: String? = null,
            @Query("search_by") searchBy: String? = null
        ): Response<WishlistResponse>

        // Récupérer un livre spécifique de la wishlist par ID
        @GET("v1/wishlist/{book_id}")
        suspend fun getWishlistBookById(@Header("Authorization") authorization: String, @Path("book_id") bookId: Int): Response<Book>

        // Ajouter un livre à la wishlist
        @POST("v1/wishlist")
        suspend fun addWishlistBook(@Header("Authorization") authorization: String, @Body book: Book): Response<MessageResponse>

        // Mettre à jour un livre de la wishlist
        @PUT("v1/wishlist/{book_id}")
        suspend fun updateWishlistBook(@Header("Authorization") authorization: String, @Path("book_id") bookId: Int, @Body book: Book): Response<MessageResponse>

        // Supprimer un livre de la wishlist
        @DELETE("v1/wishlist/{book_id}")
        suspend fun deleteWishlistBook(@Header("Authorization") authorization: String, @Path("book_id") bookId: Int): Response<MessageResponse>

        // Déplacer un livre de la wishlist vers la collection
        @POST("v1/wishlist/{book_id}/move_to_collection")
        suspend fun moveWishlistToCollection(@Header("Authorization") authorization: String, @Path("book_id") bookId: Int): Response<MessageResponse>
    }


    // --- Configuration de Retrofit ---
    object RetrofitClient {

        // L'URL de base de votre API Flask
        // ATTENTION : Si vous utilisez un émulateur Android, 'localhost' ou '127.0.0.1'
        // fait référence à l'émulateur lui-même. Pour atteindre votre machine hôte,
        // utilisez '10.0.2.2'.
        // Si vous utilisez un appareil Android physique sur le même réseau Wi-Fi que votre PC,
        // remplacez '10.0.2.2' par l'adresse IP locale de votre PC (ex: "http://192.168.1.X:8081/api/").
        private const val BASE_URL = "http://10.0.2.2:8081/api/" // <<< VÉRIFIEZ LE PORT >>>

        // Intercepteur de log pour afficher les requêtes et réponses HTTP dans Logcat (très utile pour le débogage)
        private val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        private val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(loggingInterceptor)
            .build()

        // Instance unique de l'interface ApiService, créée de manière paresseuse (lazy)
        val instance: ApiService by lazy {
            Retrofit.Builder()
                .baseUrl(BASE_URL)
                .addConverterFactory(GsonConverterFactory.create())
                .client(okHttpClient) // Utilise notre client OkHttp avec l'intercepteur de log
                .build()
                .create(ApiService::class.java)
        }
    }
