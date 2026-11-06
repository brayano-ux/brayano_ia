import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

let products = [];
let previewObjectUrl = null;

function renderProducts() {
  const container = $("#products-list");
  const count = $("#products-count");
  count.textContent = `${products.length} produit${products.length === 1 ? "" : "s"}`;

  if (!products.length) {
    container.innerHTML = '<div class="empty-state">Votre catalogue est vide. Ajoutez un premier produit pour commencer.</div>';
    return;
  }

  container.innerHTML = products.map((product) => `
    <article class="product-card${product.active ? "" : " is-inactive"}">
      <div class="product-card-image">
        ${product.imageUrl
          ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" width="400" height="400" loading="lazy" />`
          : '<span aria-hidden="true">▧</span>'}
      </div>
      <div class="product-card-content">
        <div class="product-card-title-row">
          <h3>${escapeHtml(product.name)}</h3>
          <span class="product-status ${product.active ? "available" : "unavailable"}">${product.active ? "Disponible" : "Désactivé"}</span>
        </div>
        <p class="product-card-description">${escapeHtml(product.description)}</p>
        <div class="product-card-meta">
          ${product.category ? `<span>${escapeHtml(product.category)}</span>` : ""}
          ${product.price ? `<strong>${escapeHtml(product.price)}</strong>` : ""}
          ${product.imageUrl ? "<span>Photo ajoutée</span>" : "<span>Sans photo</span>"}
        </div>
      </div>
      <div class="product-card-actions">
        <button type="button" class="text-button" data-edit-product="${escapeHtml(product.id)}">Modifier</button>
        <button type="button" class="text-button" data-toggle-product="${escapeHtml(product.id)}">${product.active ? "Désactiver" : "Activer"}</button>
        <button type="button" class="text-button danger-text" data-delete-product="${escapeHtml(product.id)}">Supprimer</button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.onclick = () => startProductEdit(button.dataset.editProduct);
  });
  container.querySelectorAll("[data-toggle-product]").forEach((button) => {
    button.onclick = () => toggleProduct(button.dataset.toggleProduct);
  });
  container.querySelectorAll("[data-delete-product]").forEach((button) => {
    button.onclick = () => removeProduct(button.dataset.deleteProduct);
  });
}

function clearImagePreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
  const preview = $("#product-image-preview");
  preview.removeAttribute("src");
  preview.classList.add("hidden");
  $("#product-image-empty").classList.remove("hidden");
}

function showImagePreview(source) {
  const preview = $("#product-image-preview");
  preview.src = source;
  preview.classList.remove("hidden");
  $("#product-image-empty").classList.add("hidden");
}

function resetProductForm() {
  const nameLabel = $("#product-image-filename");
  if (nameLabel) nameLabel.textContent = "Aucun fichier choisi";
  $("#product-form").reset();
  $("#product-id").value = "";
  $("#product-active").checked = true;
  $("#product-active-label").classList.add("hidden");
  $("#product-form-title").textContent = "Ajouter un produit";
  $("#save-product").textContent = "Ajouter au catalogue";
  $("#cancel-product-edit").classList.add("hidden");
  clearImagePreview();
}

function startProductEdit(productId) {
  const product = products.find((entry) => entry.id === productId);
  if (!product) return;

  $("#product-id").value = product.id;
  $("#product-name").value = product.name;
  $("#product-description").value = product.description;
  $("#product-category").value = product.category || "";
  $("#product-price").value = product.price || "";
  $("#product-active").checked = product.active;
  $("#product-active-label").classList.remove("hidden");
  $("#product-form-title").textContent = "Modifier le produit";
  $("#save-product").textContent = "Enregistrer les modifications";
  $("#cancel-product-edit").classList.remove("hidden");
  clearImagePreview();
  if (product.imageUrl) showImagePreview(product.imageUrl);
  $("#product-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadProductImage(productId, file) {
  return api(`/organizations/${getState().organizationId}/products/${productId}/image`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const saveButton = $("#save-product");
  const file = $("#product-image-file").files?.[0];
  const productId = $("#product-id").value;

  if (file && (!(["image/jpeg", "image/png", "image/webp"].includes(file.type)) || file.size > 5 * 1024 * 1024)) {
    showToast("Choisissez une image JPEG, PNG ou WebP de 5 Mo maximum.", "error");
    return;
  }

  const body = {
    name: $("#product-name").value.trim(),
    description: $("#product-description").value.trim(),
    category: $("#product-category").value.trim(),
    price: $("#product-price").value.trim(),
  };
  saveButton.disabled = true;

  try {
    const result = productId
      ? await api(`/organizations/${getState().organizationId}/products/${productId}`, {
          method: "PUT",
          body: JSON.stringify({ ...body, active: $("#product-active").checked }),
        })
      : await api(`/organizations/${getState().organizationId}/products`, {
          method: "POST",
          body: JSON.stringify(body),
        });
    const savedProduct = result.product;

    if (file) {
      try {
        await uploadProductImage(savedProduct.id, file);
      } catch (error) {
        resetProductForm();
        await loadProducts();
        showToast(`Produit enregistré, mais la photo n’a pas été importée : ${error.message}`, "error");
        return;
      }
    }

    resetProductForm();
    await loadProducts();
    showToast(productId ? "Produit mis à jour." : "Produit ajouté au catalogue.", "success");
  } catch (error) {
    showToast(error.message || "Impossible d’enregistrer le produit.", "error");
  } finally {
    saveButton.disabled = false;
    if (form.isConnected) $("#product-name").focus();
  }
}

async function toggleProduct(productId) {
  const product = products.find((entry) => entry.id === productId);
  if (!product) return;

  try {
    await api(`/organizations/${getState().organizationId}/products/${productId}`, {
      method: "PUT",
      body: JSON.stringify({ active: !product.active }),
    });
    await loadProducts();
  } catch (error) {
    showToast(error.message || "Impossible de modifier la disponibilité.", "error");
  }
}

async function removeProduct(productId) {
  const product = products.find((entry) => entry.id === productId);
  if (!product || !window.confirm(`Supprimer « ${product.name} » et sa photo ?`)) return;

  try {
    await api(`/organizations/${getState().organizationId}/products/${productId}`, { method: "DELETE" });
    if ($("#product-id").value === productId) resetProductForm();
    await loadProducts();
    showToast("Produit supprimé.", "success");
  } catch (error) {
    showToast(error.message || "Impossible de supprimer le produit.", "error");
  }
}

export async function loadProducts() {
  try {
    const { products: loadedProducts = [] } = await api(`/organizations/${getState().organizationId}/products`);
    products = loadedProducts;
    renderProducts();
  } catch (error) {
    showToast(error.message || "Impossible de charger le catalogue.", "error");
  }
}

export function initProducts() {
  $("#product-form").onsubmit = saveProduct;
  $("#cancel-product-edit").onclick = resetProductForm;
  $("#product-image-file").onchange = (event) => {
    const file = event.target.files?.[0];
    clearImagePreview();
    const nameLabel = $("#product-image-filename");
    if (nameLabel) nameLabel.textContent = file ? file.name : "Aucun fichier choisi";
    if (file) {
      previewObjectUrl = URL.createObjectURL(file);
      showImagePreview(previewObjectUrl);
    }
  };
}
