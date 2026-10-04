package com.antijam.nav.core

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

class TripFileProvider : ContentProvider() {
    companion object {
        const val AUTHORITY = "com.antijam.nav.core.tripfiles"

        fun uriFor(file: File): Uri = Uri.Builder()
            .scheme("content")
            .authority(AUTHORITY)
            .appendPath("trips")
            .appendPath(file.name)
            .build()
    }

    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String = "text/csv"

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?
    ): Cursor {
        val file = resolveFile(uri)
        val requested = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val supported = requested.filter {
            it == OpenableColumns.DISPLAY_NAME || it == OpenableColumns.SIZE
        }
        val cursor = MatrixCursor(supported.toTypedArray(), 1)
        val row = cursor.newRow()
        supported.forEach { column ->
            when (column) {
                OpenableColumns.DISPLAY_NAME -> row.add(file.name)
                OpenableColumns.SIZE -> row.add(file.length())
            }
        }
        return cursor
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Read-only provider")
        val file = resolveFile(uri)
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    private fun resolveFile(uri: Uri): File {
        if (uri.authority != AUTHORITY) throw FileNotFoundException("Wrong authority")
        val segments = uri.pathSegments
        if (segments.size != 2 || segments[0] != "trips") {
            throw FileNotFoundException("Invalid trip URI")
        }
        val context = context ?: throw FileNotFoundException("Provider not attached")
        val root = File(context.getExternalFilesDir(null) ?: context.filesDir, "trips").canonicalFile
        val candidate = File(root, segments[1]).canonicalFile
        if (candidate.parentFile != root || !candidate.isFile || !candidate.name.endsWith(".csv", ignoreCase = true)) {
            throw FileNotFoundException("Trip file not found")
        }
        return candidate
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("Read only")

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
        throw UnsupportedOperationException("Read only")

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?
    ): Int = throw UnsupportedOperationException("Read only")
}
