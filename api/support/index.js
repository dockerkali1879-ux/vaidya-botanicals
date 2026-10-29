const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');

function generateTicketNumber() {
    return 'TKT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

module.exports = async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            const { name, email, phone, order_number, category, subject, message, attachments } = req.body || {};

            if (!email || !message) {
                return res.status(400).json({ error: 'Email and message are required' });
            }

            const ticketNumber = generateTicketNumber();
            const newTicket = {
                ticket_number: ticketNumber,
                customer_email: String(email).trim().toLowerCase(),
                customer_phone: phone ? String(phone).trim() : null,
                order_number: order_number ? String(order_number).trim() : null,
                category: category || 'General Question',
                subject: subject || 'Customer Inquiry',
                message: message.trim(),
                attachments: Array.isArray(attachments) ? attachments : [],
                status: 'open',
                internal_notes: '',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('support_tickets').insert([newTicket]).select().single();
                if (error) throw error;
                return res.status(201).json({
                    success: true,
                    ticket_number: data.ticket_number,
                    message: 'Your support case has been recorded. Our botanical care team will follow up shortly.'
                });
            } else {
                newTicket.id = 'tkt-' + Date.now().toString(36);
                mockDb.supportTickets.unshift(newTicket);
                return res.status(201).json({
                    success: true,
                    ticket_number: newTicket.ticket_number,
                    message: 'Your support case has been recorded. Our botanical care team will follow up shortly.'
                });
            }
        } catch (err) {
            console.error('[Submit Support Ticket Error]:', err);
            return res.status(500).json({ error: 'Failed to submit support case' });
        }
    }

    if (req.method === 'GET') {
        // Customer status lookup
        try {
            const { ticket_number, email } = req.query || {};
            if (!ticket_number || !email) {
                return res.status(400).json({ error: 'ticket_number and email are required for verification' });
            }

            let found = null;
            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase
                    .from('support_tickets')
                    .select('ticket_number, category, subject, message, status, created_at, updated_at')
                    .eq('ticket_number', ticket_number)
                    .eq('customer_email', email.trim().toLowerCase())
                    .single();

                if (error || !data) return res.status(404).json({ error: 'Ticket not found' });
                found = data;
            } else {
                const match = mockDb.supportTickets.find(
                    t => t.ticket_number === ticket_number && t.customer_email.toLowerCase() === email.trim().toLowerCase()
                );
                if (!match) return res.status(404).json({ error: 'Ticket not found' });
                found = {
                    ticket_number: match.ticket_number,
                    category: match.category,
                    subject: match.subject,
                    message: match.message,
                    status: match.status,
                    created_at: match.created_at,
                    updated_at: match.updated_at
                };
            }

            return res.status(200).json({ ticket: found });
        } catch (err) {
            return res.status(500).json({ error: 'Lookup failed' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
};
