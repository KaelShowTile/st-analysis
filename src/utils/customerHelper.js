/**
 * Helper to format customer display name from customer table joined fields
 */
export const formatCustomerName = (row) => {
    if (!row) return '-';
    const company = (row.customer_company || '').trim();
    const name = [row.customer_first_name, row.customer_last_name]
        .map(p => (p ?? '').toString().trim())
        .filter(Boolean)
        .join(' ');
    const contact = (row.customer_contact || '').trim();

    if (company && name) return `${company} (${name})`;
    if (company) return company;
    if (name) return name;
    if (contact) return contact;
    if (row.customer_id) return `Customer #${row.customer_id}`;
    return '-';
};
