# =============================================================================
# PANDAS FOR BEGINNERS (THINK OF IT LIKE EXCEL!)
# =============================================================================
# What is Pandas? 
# It's a Python tool for working with tables (spreadsheets).
#
# Two basic words to remember:
# 1. DataFrame = The ENTIRE table (all rows + all columns).
# 2. Series    = ONE SINGLE column from that table.
# =============================================================================

import pandas as pd

# -----------------------------------------------------------------------------
# LESSON 1: CREATING A TABLE
# Imagine typing this table into Excel:
# -----------------------------------------------------------------------------
data = {
    'Product': ['Laptop', 'Mouse', 'Keyboard', 'Monitor'],
    'Price': [1200, 25, 45, 300],
    'Quantity': [3, 15, 10, 4]
}

# Turn the data into a Pandas table (DataFrame)
df = pd.DataFrame(data)

print("--- OUR EXCEL TABLE ---")
print(df)


# -----------------------------------------------------------------------------
# LESSON 2: PICKING COLUMNS FROM YOUR TABLE
# -----------------------------------------------------------------------------
# Want JUST 1 column? Use single brackets ['ColumnName']
# (This is a Series)
prices = df['Price']
print("\n--- JUST THE PRICE COLUMN ---")
print(prices)

# Want MULTIPLE columns? Use double brackets [['Col1', 'Col2']]
# (This is a smaller DataFrame)
product_and_price = df[['Product', 'Price']]
print("\n--- PRODUCT AND PRICE COLUMNS ---")
print(product_and_price)


# -----------------------------------------------------------------------------
# LESSON 3: FILTERING ROWS (LIKE EXCEL FILTERS)
# -----------------------------------------------------------------------------
# Show me only items that cost more than $50:
expensive_items = df[df['Price'] > 50]
print("\n--- ITEMS COSTING MORE THAN $50 ---")
print(expensive_items)


# -----------------------------------------------------------------------------
# LESSON 4: MATH & FORMULAS
# -----------------------------------------------------------------------------
# In Excel: =C2*D2 (Price * Quantity)
# In Pandas:
df['Total_Spent'] = df['Price'] * df['Quantity']

print("\n--- TABLE WITH NEW 'Total_Spent' COLUMN ---")
print(df)

# Quick totals (like Excel SUM and AVERAGE)
grand_total = df['Total_Spent'].sum()
average_price = df['Price'].mean()

print(f"\nGrand Total Spent: ${grand_total}")
print(f"Average Price:     ${average_price}")
