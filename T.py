# LEVEL 4: ADVANCED EXPENSE INSIGHTS WITH PANDAS

import pandas as pd

print("\n--- Enter your expenses (type 'done' when finished) ---")

# 1. Standard Python Loop to collect items
while True:
    Item = input("Enter the item: ")
    
    if Item.strip().lower() == "done":
        break
        
    Price = input("Enter the price: ")
    
    with open("expenses.txt", "a") as file:
        file.write(f"{Item},{Price}\n")


print("\n--- Summary of All Expenses (Powered by Pandas!) ---")

# 2. Load the data file as a DataFrame table
df = pd.read_csv("expenses.txt", names=["Item", "Price"])

# Print the beautiful table
print(df.to_string(index=False))


print("\n" + "="*40)
print("🎯 BUSINESS ANALYST EXPENSE INSIGHTS")
print("="*40)

# 3. Calculate advanced descriptive statistics instantly!
total_spent = df["Price"].sum()
average_price = df["Price"].mean()      # Calculates the average (mean)
most_expensive = df["Price"].max()     # Finds the highest price
cheapest_item = df["Price"].min()      # Finds the lowest price
item_count = df["Price"].count()       # Counts total number of transactions

print(f"Total Transactions: {item_count}")
print(f"Total Spent:        ${total_spent:.2f}")
print(f"Average Item Cost:  ${average_price:.2f}")
print(f"Most Expensive:     ${most_expensive:.2f}")
print(f"Cheapest Item:      ${cheapest_item:.2f}")


print("\n" + "="*40)
print("🔍 HIGH-VALUE EXPENSES (Over $10.00)")
print("="*40)

# 4. Filter the data to see only expensive items (greater than $10.00)
# This is like using the 'Filter' dropdown in Excel!
expensive_items = df[df["Price"] > 10.0]

if expensive_items.empty:
    print("No items found costing more than $10.00.")
else:
    print(expensive_items.to_string(index=False))