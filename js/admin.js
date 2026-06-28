// js/admin.js
(async () => {
  const container = document.getElementById('admin-content');
  if (!container) return;

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      container.innerHTML = `<div class="alert alert-danger">Erro de autenticação: ${authError.message}. Verifique se o Supabase está configurado corretamente.</div>`;
      console.error('Auth error:', authError);
      return;
    }

    if (!user) {
      showLoginForm(container);
      return;
    }

    await showDashboard(container, user);
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Erro ao inicializar: ${e.message}. Abra o console (F12) para mais detalhes.</div>`;
    console.error('Admin init error:', e);
  }
})();

function showLoginForm(container) {
  container.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-md-6">
        <h2>Login Administrativo</h2>
        <form id="login-form">
          <div class="mb-3">
            <label for="email" class="form-label">Email</label>
            <input type="email" class="form-control" id="email" required>
          </div>
          <div class="mb-3">
            <label for="password" class="form-label">Senha</label>
            <input type="password" class="form-control" id="password" required>
          </div>
          <button type="submit" class="btn btn-primary">Entrar</button>
        </form>
        <div id="login-error" class="mt-2 text-danger"></div>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        document.getElementById('login-error').textContent = 'Login inválido.';
      } else {
        window.location.reload();
      }
    } catch (err) {
      document.getElementById('login-error').textContent = 'Erro ao tentar login. Tente novamente.';
    }
  });
}

async function showDashboard(container, user) {
  container.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2>Painel de Administração</h2>
      <button id="logout-btn" class="btn btn-secondary">Sair</button>
    </div>
    <ul class="nav nav-tabs" id="adminTabs" role="tablist">
      <li class="nav-item"><a class="nav-link active" data-bs-toggle="tab" href="#products-tab">Produtos</a></li>
      <li class="nav-item"><a class="nav-link" data-bs-toggle="tab" href="#config-tab">Configurações</a></li>
    </ul>
    <div class="tab-content mt-3">
      <div class="tab-pane fade show active" id="products-tab">
        <button class="btn btn-success mb-3" id="new-product-btn">Novo Produto</button>
        <div id="products-list"></div>
      </div>
      <div class="tab-pane fade" id="config-tab">
        <div id="config-form-container"></div>
      </div>
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.reload();
  });

  // Listener do botão "Novo Produto" sempre registrado, independente da lista
  document.getElementById('new-product-btn').addEventListener('click', () => showProductForm());

  try {
    loadProducts();
    loadConfigForm();
  } catch (e) {
    console.error('Dashboard load error:', e);
  }
}

async function loadProducts() {
  const listEl = document.getElementById('products-list');
  if (!listEl) return;

  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    listEl.innerHTML = '<div class="alert alert-danger">Erro ao carregar produtos.</div>';
    return;
  }

  if (!products.length) {
    listEl.innerHTML = '<p>Nenhum produto cadastrado.</p>';
    return;
  }

  let html = '<div class="table-responsive"><table class="table table-bordered">';
  html += '<thead><tr><th>Imagem</th><th>Nome</th><th>Preço</th><th>Status</th><th>Ações</th></tr></thead><tbody>';
  for (const p of products) {
    const status = p.status;
    let actions = '';
    if (status === 'Reservado') {
      const remaining = getTimeRemaining(p.reserved_at);
      actions = `<span>Tempo restante: ${remaining}</span><br>
                 <button class="btn btn-sm btn-success confirm-payment-btn" data-id="${p.id}">Confirmar pagamento</button>`;
    } else if (status === 'Indisponível Temporariamente') {
      actions = `<button class="btn btn-sm btn-success confirm-payment-btn" data-id="${p.id}">Confirmar pagamento</button>
                 <button class="btn btn-sm btn-warning release-btn" data-id="${p.id}">Liberar para venda</button>`;
    } else if (status === 'Disponível' || status === 'Vendido') {
      actions = `<button class="btn btn-sm btn-primary edit-btn" data-id="${p.id}">Editar</button>
                 <button class="btn btn-sm btn-danger delete-btn" data-id="${p.id}">Excluir</button>`;
    }
    html += `<tr>
      <td><img src="${p.image_url || 'https://via.placeholder.com/50'}" width="50"></td>
      <td>${escapeHtml(p.name)}</td>
      <td>R$ ${parseFloat(p.price).toFixed(2)}</td>
      <td><span class="badge bg-${statusBadgeClass(p.status)}">${p.status}</span></td>
      <td>${actions}</td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  listEl.innerHTML = html;

  // Listeners para os botões da lista (confirmar, liberar, editar, excluir)
  document.querySelectorAll('.confirm-payment-btn').forEach(b => b.addEventListener('click', confirmPayment));
  document.querySelectorAll('.release-btn').forEach(b => b.addEventListener('click', releaseProduct));
  document.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', editProduct));
  document.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', deleteProduct));
}

function getTimeRemaining(reservedAt) {
  if (!reservedAt) return '--';
  const expires = new Date(new Date(reservedAt).getTime() + 10*60*1000);
  const diff = expires - new Date();
  if (diff <= 0) return 'Expirado';
  const m = Math.floor(diff/60000);
  const s = Math.floor((diff%60000)/1000);
  return `${m}:${String(s).padStart(2,'0')}`;
}

async function confirmPayment(e) {
  const id = e.target.dataset.id;
  if (!confirm('Confirmar pagamento e marcar como Vendido?')) return;
  const { error } = await supabase.rpc('confirm_payment', { p_product_id: id });
  if (error) alert('Erro: ' + error.message);
  else loadProducts();
}

async function releaseProduct(e) {
  const id = e.target.dataset.id;
  if (!confirm('Liberar produto para venda?')) return;
  const { error } = await supabase.rpc('release_product', { p_product_id: id });
  if (error) alert('Erro: ' + error.message);
  else loadProducts();
}

function showProductForm(product = null) {
  const modalHtml = `
    <div class="modal fade" id="productModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <form id="product-form">
            <div class="modal-header">
              <h5 class="modal-title">${product ? 'Editar Produto' : 'Novo Produto'}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" name="id" value="${product?.id || ''}">
              <div class="mb-3">
                <label class="form-label">Nome</label>
                <input type="text" class="form-control" name="name" value="${escapeHtml(product?.name || '')}" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Descrição</label>
                <textarea class="form-control" name="description">${escapeHtml(product?.description || '')}</textarea>
              </div>
              <div class="mb-3">
                <label class="form-label">Preço</label>
                <input type="number" step="0.01" class="form-control" name="price" value="${product?.price || ''}" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Imagem</label>
                <input type="file" class="form-control" name="image" accept="image/*">
                ${product?.image_url ? `<img src="${product.image_url}" class="mt-2 img-thumbnail" width="100">` : ''}
              </div>
            </div>
            <div class="modal-footer">
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modal = new bootstrap.Modal(document.getElementById('productModal'));
  modal.show();
  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.id.value;
    const name = form.name.value;
    const description = form.description.value;
    const price = parseFloat(form.price.value);
    const imageFile = form.image.files[0];

    let image_url = product?.image_url || null;
    if (imageFile) {
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const { data: upload, error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(fileName, imageFile, { cacheControl: '3600', upsert: true });
      if (uploadError) {
        alert('Erro no upload da imagem: ' + uploadError.message);
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('product-images').getPublicUrl(fileName);
      image_url = publicUrlData.publicUrl;
    }

    if (id) {
      const { error } = await supabase
        .from('products')
        .update({ name, description, price, image_url, updated_at: new Date() })
        .eq('id', id);
      if (error) alert('Erro: ' + error.message);
    } else {
      const { error } = await supabase
        .from('products')
        .insert({ name, description, price, image_url });
      if (error) alert('Erro: ' + error.message);
    }
    modal.hide();
    loadProducts();
  });
  document.getElementById('productModal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('productModal').remove();
  });
}

function editProduct(e) {
  const id = e.target.dataset.id;
  supabase.from('products').select('*').eq('id', id).single().then(({ data }) => {
    if (data) showProductForm(data);
  });
}

async function deleteProduct(e) {
  const id = e.target.dataset.id;
  if (!confirm('Excluir permanentemente este produto?')) return;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) alert('Erro: ' + error.message);
  else loadProducts();
}

async function loadConfigForm() {
  const { data: config } = await supabase.from('config').select('*').eq('id', 1).single();
  const container = document.getElementById('config-form-container');
  if (!container) return;
  container.innerHTML = `
    <form id="config-form">
      <div class="mb-3">
        <label class="form-label">URL do QR Code Pix</label>
        <input type="text" class="form-control" name="pix_qr_code_url" value="${config?.pix_qr_code_url || ''}">
        <small class="text-muted">Cole a URL pública da imagem do QR Code (faça upload em algum serviço ou use o Supabase Storage).</small>
      </div>
      <div class="mb-3">
        <label class="form-label">Código Pix Copia e Cola</label>
        <textarea class="form-control" name="pix_copy_paste">${config?.pix_copy_paste || ''}</textarea>
      </div>
      <div class="mb-3">
        <label class="form-label">Número WhatsApp (com código do país, ex: 5511999999999)</label>
        <input type="text" class="form-control" name="whatsapp_number" value="${config?.whatsapp_number || ''}">
      </div>
      <button type="submit" class="btn btn-primary">Salvar Configurações</button>
    </form>
  `;
  document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const pix_qr_code_url = form.pix_qr_code_url.value;
    const pix_copy_paste = form.pix_copy_paste.value;
    const whatsapp_number = form.whatsapp_number.value;
    const { error } = await supabase
      .from('config')
      .update({ pix_qr_code_url, pix_copy_paste, whatsapp_number })
      .eq('id', 1);
    if (error) alert('Erro: ' + error.message);
    else alert('Configurações salvas.');
  });
}

function statusBadgeClass(status) {
  switch(status) {
    case 'Disponível': return 'success';
    case 'Reservado': return 'warning';
    case 'Indisponível Temporariamente': return 'secondary';
    case 'Vendido': return 'dark';
    default: return 'light';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
