import { api } from "../../services/api.js";
import { $, $$, debounce, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { confirmDialog } from "../../ui/confirm.js";
import { closeDrawer, openDrawer } from "../../ui/drawer.js";
import { icon } from "../../ui/icons.js";

/**
 * Catalogue : grille des produits (recherche, filtre par catégorie) et fiche d'ajout / de modification
 * dans un panneau latéral. La photo est envoyée après la fiche, comme une étape séparée côté serveur.
 */

let products = [];
let previewObjectUrl = null;
let searchText = "";
let categoryFilter = "";
let formSnapshot = "";

const normalize = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function visibleProducts() {
  const needle = normalize(searchText.trim());
  return products.filter((product) => {
    if (categoryFilter === "__inactive") { if (product.active) return false; }
    else if (categoryFilter && (product.category || "") !== categoryFilter) return false;
    if (!needle) return true;
    return normalize(`${product.name} ${product.category || ""} ${product.description || ""}`).includes(needle);
  });
}

function renderCategories() {
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const inactive = products.filter((product) => !product.active).length;
  const box = $("#products-categories");
  // Sans catégorie ni produit désactivé, la rangée de filtres n'apporterait rien.
  box.classList.toggle("hidden", !categories.length && !inactive);
  const chips = [{ value: "", label: "Tous", count: products.length }, ...categories.map((category) => ({ value: category, label: category, count: products.filter((product) => product.category === category).length }))];
  if (inactive) chips.push({ value: "__inactive", label: "Désactivés", count: inactive });
  if (!chips.some((chip) => chip.value === categoryFilter)) categoryFilter = "";
  box.innerHTML = chips.map((chip) => `<button type="button" class="chip${chip.value === categoryFilter ? " active" : ""}" data-category="${escapeHtml(chip.value)}" aria-pressed="${chip.value === categoryFilter}">${escapeHtml(chip.label)}<span class="chip-count">${chip.count}</span></button>`).join("");
  $$("[data-category]", box).forEach((button) => {
    button.onclick = () => {
      categoryFilter = button.dataset.category;
      renderProducts();
    };
  });
  $("#product-categories-list").innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
}

function cardMarkup(product) {
  return `
    <article class="card product-card${product.active ? "" : " is-inactive"}">
      <button type="button" class="product-card-image" data-edit-product="${escapeHtml(product.id)}" aria-label="Modifier ${escapeHtml(product.name)}">
        ${product.imageUrl
          ? `<img src="${escapeHtml(product.imageUrl)}" alt="" width="400" height="400" loading="lazy" />`
          : `<span class="product-card-noimage">${icon("image", "icon-xl")}<small>Sans photo</small></span>`}
        ${product.active ? "" : '<span class="badge neutral product-card-flag">Désactivé</span>'}
      </button>
      <div class="product-card-content">
        <div class="product-card-title-row">
          <h3 class="truncate" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
          <div class="menu-anchor">
            <button type="button" class="btn-icon btn-sm btn-ghost" data-menu="product-menu-${escapeHtml(product.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour ${escapeHtml(product.name)}">${icon("more-vertical", "icon-sm")}</button>
            <div class="menu" id="product-menu-${escapeHtml(product.id)}" role="menu">
              <button type="button" class="menu-item" role="menuitem" data-edit-product="${escapeHtml(product.id)}">${icon("edit")}Modifier</button>
              <button type="button" class="menu-item" role="menuitem" data-toggle-product="${escapeHtml(product.id)}">${icon(product.active ? "eye-off" : "eye")}${product.active ? "Désactiver" : "Réactiver"}</button>
              <div class="menu-sep"></div>
              <button type="button" class="menu-item danger" role="menuitem" data-delete-product="${escapeHtml(product.id)}">${icon("trash")}Supprimer</button>
            </div>
          </div>
        </div>
        <p class="product-card-price">${product.price ? escapeHtml(product.price) : '<span class="subtle">Prix non indiqué</span>'}</p>
        <p class="product-card-description">${escapeHtml(product.description)}</p>
        ${product.category ? `<span class="badge neutral product-card-category">${escapeHtml(product.category)}</span>` : ""}
      </div>
    </article>`;
}

function renderProducts() {
  const container = $("#products-list");
  const visible = visibleProducts();
  renderCategories();
  $("#products-count").textContent = visible.length === products.length
    ? `${products.length} produit${products.length === 1 ? "" : "s"}`
    : `${visible.length} sur ${products.length} produit${products.length === 1 ? "" : "s"}`;
  $(".products-toolbar").classList.toggle("hidden", !products.length);

  if (!products.length) {
    container.className = "products-empty";
    container.innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon("package")}</span><p class="empty-title">Votre catalogue est vide</p><p class="empty-text">Ajoutez vos articles avec leur photo et leur prix : votre agent pourra les recommander et les montrer à vos clients sur WhatsApp.</p><button type="button" class="btn btn-primary" data-add-product>${icon("plus")}Ajouter mon premier produit</button></div></div>`;
  } else if (!visible.length) {
    container.className = "products-empty";
    container.innerHTML = `<div class="card"><div class="empty empty-compact"><span class="empty-icon">${icon("search")}</span><p class="empty-title">Aucun produit trouvé</p><p class="empty-text">Aucun article ne correspond à cette recherche ou à ce filtre.</p><button type="button" class="btn btn-secondary btn-sm" data-clear-products>Tout afficher</button></div></div>`;
  } else {
    container.className = "products-grid";
    container.innerHTML = visible.map(cardMarkup).join("");
  }

  $$("[data-edit-product]", container).forEach((button) => { button.onclick = () => startProductEdit(button.dataset.editProduct); });
  $$("[data-toggle-product]", container).forEach((button) => { button.onclick = () => toggleProduct(button.dataset.toggleProduct); });
  $$("[data-delete-product]", container).forEach((button) => { button.onclick = () => removeProduct(button.dataset.deleteProduct); });
  $("[data-add-product]", container)?.addEventListener("click", openProductForm);
  $("[data-clear-products]", container)?.addEventListener("click", () => {
    searchText = "";
    categoryFilter = "";
    $("#products-search").value = "";
    renderProducts();
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

function snapshotForm() {
  return JSON.stringify([$("#product-name").value, $("#product-description").value, $("#product-category").value, $("#product-price").value, $("#product-active").checked, $("#product-image-file").files?.length || 0]);
}

function resetProductForm() {
  $("#product-image-filename").textContent = "Aucun fichier choisi";
  $("#product-form").reset();
  $("#product-id").value = "";
  $("#product-active").checked = true;
  $("#product-active-label").classList.add("hidden");
  $("#product-form-title").textContent = "Ajouter un produit";
  $("#save-product").textContent = "Ajouter au catalogue";
  clearImagePreview();
}

/** Fermer la fiche avec une saisie en cours demande confirmation : on ne perd pas un produit à moitié rempli. */
async function canCloseForm() {
  if (snapshotForm() === formSnapshot) return true;
  return confirmDialog({ title: "Fermer sans enregistrer ?", message: "Ce que vous avez saisi pour ce produit sera perdu.", confirmLabel: "Fermer sans enregistrer", cancelLabel: "Continuer la saisie", tone: "danger" });
}

function showDrawer(focus) {
  formSnapshot = snapshotForm();
  openDrawer($("#product-drawer"), { focus, canClose: canCloseForm, onClose: resetProductForm });
}

/** Ouvre la fiche vide pour ajouter un produit (bouton de la page, accueil, recherche rapide). */
export function openProductForm() {
  resetProductForm();
  showDrawer("#product-name");
}

function startProductEdit(productId) {
  const product = products.find((entry) => entry.id === productId);
  if (!product) return;

  resetProductForm();
  $("#product-id").value = product.id;
  $("#product-name").value = product.name;
  $("#product-description").value = product.description;
  $("#product-category").value = product.category || "";
  $("#product-price").value = product.price || "";
  $("#product-active").checked = product.active;
  $("#product-active-label").classList.remove("hidden");
  $("#product-form-title").textContent = "Modifier le produit";
  $("#save-product").textContent = "Enregistrer";
  if (product.imageUrl) showImagePreview(product.imageUrl);
  showDrawer("#product-name");
}

async function uploadProductImage(productId, file) {
  return api(`/organizations/${getState().organizationId}/products/${productId}/image`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
}

async function closeForm() {
  await closeDrawer($("#product-drawer"), { force: true });
}

async function saveProduct(event) {
  event.preventDefault();
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
  saveButton.classList.add("is-loading");

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
        await closeForm();
        await loadProducts();
        showToast(`Produit enregistré, mais la photo n’a pas été importée : ${error.message}`, "error");
        return;
      }
    }

    await closeForm();
    await loadProducts();
    showToast(productId ? "Produit mis à jour." : "Produit ajouté au catalogue.", "success");
  } catch (error) {
    showToast(error.message || "Impossible d’enregistrer le produit.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.classList.remove("is-loading");
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
    showToast(product.active ? "Produit désactivé : l'agent ne le propose plus." : "Produit réactivé.", "success");
  } catch (error) {
    showToast(error.message || "Impossible de modifier la disponibilité.", "error");
  }
}

async function removeProduct(productId) {
  const product = products.find((entry) => entry.id === productId);
  if (!product) return;
  const confirmed = await confirmDialog({ title: `Supprimer « ${product.name} » ?`, message: "Le produit et sa photo seront supprimés du catalogue. Cette action est définitive.", confirmLabel: "Supprimer", tone: "danger", iconName: "trash" });
  if (!confirmed) return;

  try {
    await api(`/organizations/${getState().organizationId}/products/${productId}`, { method: "DELETE" });
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
    $("#products-list").className = "products-empty";
    $("#products-list").innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon("alert")}</span><p class="empty-title">Catalogue indisponible</p><p class="empty-text">${escapeHtml(error.message || "Impossible de charger le catalogue.")}</p></div></div>`;
  }
}

export function initProducts() {
  $("#product-form").onsubmit = saveProduct;
  $("#add-product").onclick = openProductForm;
  $("#cancel-product-edit").onclick = () => void closeDrawer($("#product-drawer"));
  $("#products-search").addEventListener("input", debounce((event) => {
    searchText = event.target.value;
    renderProducts();
  }, 120));
  $("#product-image-file").onchange = (event) => {
    const file = event.target.files?.[0];
    clearImagePreview();
    $("#product-image-filename").textContent = file ? file.name : "Aucun fichier choisi";
    if (file) {
      previewObjectUrl = URL.createObjectURL(file);
      showImagePreview(previewObjectUrl);
    }
  };
}
