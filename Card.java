package card51;

public class Card {
    public enum Suit {
        CLUBS, DIAMONDS, HEARTS, SPADES, JOKER
    }

    public enum Rank {
        TWO, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE, TEN, JACK, QUEEN, KING, ACE, JOKER
    }

    private final Suit suit;
    private final Rank rank;
    private final boolean isJoker;

    public Card(Suit suit, Rank rank) {
        this.suit = suit;
        this.rank = rank;
        this.isJoker = (rank == Rank.JOKER);
    }

    public Suit getSuit() {
        return suit;
    }

    public Rank getRank() {
        return rank;
    }

    public boolean isJoker() {
        return isJoker;
    }

    public int getValue() {
        if (isJoker)
            return 0;
        switch (rank) {
            case ACE:
            case KING:
            case QUEEN:
            case JACK:
            case TEN:
                return 10;
            case TWO:
                return 2;
            case THREE:
                return 3;
            case FOUR:
                return 4;
            case FIVE:
                return 5;
            case SIX:
                return 6;
            case SEVEN:
                return 7;
            case EIGHT:
                return 8;
            case NINE:
                return 9;
            default:
                return 0;
        }
    }

    @Override
    public String toString() {
        return isJoker ? "JOKER" : rank + " of " + suit;
    }
}